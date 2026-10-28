const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

test('image generation reserves credits, records provider cost and saves owned output', async () => {
  let state;
  const reset = () => { state = { auth: true, calls: [], mode: 'ok' }; };
  const admin = {
    from() { return { select() { return { eq() { return { maybeSingle: async () => ({ data: { email: 'user@example.test', openclaw_instance: null }, error: null }) }; } }; } }; },
    rpc(name, args) { return { single: async () => {
      state.calls.push({ name, args });
      if (name === 'reserve_chat_credits_itemized') return state.mode === 'insufficient' ? { data: null, error: { message: 'insufficient_ai_credits' } } : { data: { request_id: 'request-1', llm_token_quota: 20000, llm_token_used: 10000 }, error: null };
      return { data: { llm_token_quota: 20000, llm_token_used: args.p_actual_credits, charged_credits: args.p_actual_credits }, error: null };
    } }; }
  };
  const mocks = {
    '@/lib/admin': { isAdminUser: async () => false },
    '@/lib/chat-files': { saveChatGeneratedImage: async (_admin, user, bytes, mime) => { state.saved = { user, bytes, mime }; return { id: 'image-1', name: 'generated-image.png' }; } },
    '@/lib/env': { hasSupabaseEnv: () => true },
    '@/lib/onboarding': { getUserIdFromClaims: claims => claims?.sub },
    '@/lib/supabase/admin': { createAdminClient: () => admin, hasSupabaseServiceRoleEnv: () => true },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: state.auth ? { sub: 'user-1' } : null }, error: null }) } }) },
    '@/lib/token-quota-redis': { publishTokenQuotaUpdate: async () => true }
  };
  const filename = path.resolve(__dirname, '../app/api/chat/generate-image/route.ts');
  const instance = new Module(filename, module); instance.filename = filename; instance.paths = module.paths;
  const originalLoad = Module._load; const originalFetch = global.fetch; const originalKey = process.env.OPENROUTER_API_KEY;
  let route;
  try {
    Module._load = function(request, ...args) { return Object.hasOwn(mocks, request) ? mocks[request] : originalLoad.call(this, request, ...args); };
    instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
    route = instance.exports;
  } finally { Module._load = originalLoad; }
  process.env.OPENROUTER_API_KEY = 'test-key';
  global.fetch = async (url, options) => {
    if (String(url).endsWith('/endpoints')) return Response.json({ endpoints: [{ pricing: [{ billable: 'output_image', unit: 'image', cost_usd: state.mode === 'bad-price' ? -1 : 0.04 }, { billable: 'input_image', unit: 'image', cost_usd: 0 }] }] });
    state.providerBody = JSON.parse(options.body);
    if (state.mode === 'network') throw Error('network');
    if (state.mode === 'rejected') return Response.json({}, { status: 400 });
    const bytes = Buffer.from([137,80,78,71,13,10,26,10,1]);
    return Response.json({ id: 'provider-1', data: [{ b64_json: bytes.toString('base64') }], ...(state.mode === 'missing-usage' ? {} : { usage: { cost: 0.032 } }) });
  };
  const request = (origin = 'http://localhost') => new Request('http://localhost/api/chat/generate-image', { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost', origin }, body: JSON.stringify({ prompt: 'a lighthouse' }) });
  try {
    reset(); state.auth = false; assert.equal((await route.POST(request())).status, 401); assert.equal(state.calls.length, 0);
    reset(); assert.equal((await route.POST(request('http://evil.test'))).status, 403);
    reset(); state.mode = 'bad-price'; assert.equal((await route.POST(request())).status, 503); assert.equal(state.calls.length, 0);
    reset(); state.mode = 'insufficient'; assert.equal((await route.POST(request())).status, 402); assert.equal(state.providerBody, undefined);
    reset(); const quote = await (await route.GET()).json(); assert.equal(quote.credits, 10000);
    const response = await route.POST(request()); const result = await response.json();
    assert.equal(response.status, 200); assert.equal(state.calls[0].args.p_kind, 'image_generation'); assert.equal(state.calls[0].args.p_credits, 10000);
    assert.equal(state.calls[1].args.p_status, 'completed'); assert.equal(state.calls[1].args.p_cost_usd, 0.032); assert.equal(result.chargedCredits, 8000);
    assert.equal(state.saved.user, 'user-1'); assert.equal(state.saved.mime, 'image/png'); assert.equal(result.savedOutput.id, 'image-1');
    assert.equal(state.providerBody.n, 1); assert.equal(state.providerBody.prompt, 'a lighthouse');
    reset(); state.mode = 'missing-usage'; const unknown = await (await route.POST(request())).json(); assert.equal(unknown.usagePending, true); assert.equal(unknown.savedOutput.id, 'image-1'); assert.equal(state.calls[1].args.p_status, 'uncertain');
    reset(); state.mode = 'network'; assert.equal((await route.POST(request())).status, 502); assert.equal(state.calls[1].args.p_status, 'uncertain');
    reset(); state.mode = 'rejected'; assert.equal((await route.POST(request())).status, 502); assert.equal(state.calls[1].args.p_status, 'failed');
  } finally { global.fetch = originalFetch; if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey; }
});
