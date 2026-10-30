const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function load(mocks) {
  const filename = path.resolve(__dirname, '../lib/wiki-openrouter.ts');
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths;
  const original = Module._load;
  try {
    Module._load = function(request) { return Object.hasOwn(mocks, request) ? mocks[request] : original.apply(this, arguments); };
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  } finally { Module._load = original; }
  return mod.exports;
}

test('Nth Brain OpenRouter requests reserve credits, settle actual cost, and validate output', async () => {
  const priorFetch = global.fetch, priorKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';
  const calls = [], requests = [];
  const admin = {
    from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { email: 'user@example.test', openclaw_instance: 'instance', openclaw_tokens_paused: false }, error: null }; } }; },
    rpc(name, args) { calls.push({ name, args }); return { async single() { return { data: name.startsWith('reserve') ? { request_id: 'r1', llm_token_quota: 100000, llm_token_used: 1000 } : { llm_token_quota: 100000, llm_token_used: 30 }, error: null }; } }; }
  };
  const mod = load({ '@/lib/admin': { isAdminUser: async () => false }, '@/lib/chat-models': { FILE_CHAT_MODEL: 'google/gemini-2.5-flash' }, '@/lib/supabase/admin': { createAdminClient: () => admin }, '@/lib/token-quota-redis': { publishTokenQuotaUpdate: async () => {} } });
  let response = { id: 'gen-1', usage: { cost: 0.00012, prompt_tokens: 100, completion_tokens: 25 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ pages: [{ path: 'wiki/entities/maya.md', content: '# Maya' }] }) } }] };
  global.fetch = async (url, options) => {
    if (url.endsWith('/models')) return { ok: true, json: async () => ({ data: [{ id: 'google/gemini-2.5-flash', pricing: { prompt: '0.0000003', completion: '0.0000025' } }] }) };
    requests.push(JSON.parse(options.body));
    return { ok: true, headers: { get: () => null }, json: async () => response };
  };
  const input = { userId: 'u1', instance: 'instance', instruction: 'Use the source', existingPages: [], attachments: [{ fileName: 'source.pdf', markdown: 'Maya owns the pilot.', path: 'raw/sources/source.md', sourceType: 'pdf' }] };
  try {
    const pages = await mod.generateWikiWithOpenRouter(input);
    assert.equal(pages[0].path, 'wiki/entities/maya.md');
    assert.equal(requests[0].model, 'google/gemini-2.5-flash');
    assert.match(JSON.stringify(requests[0].messages), /Maya owns the pilot/);
    assert.equal(calls[0].args.p_kind, 'wiki_generation');
    assert.equal(calls[1].args.p_status, 'completed');
    assert.equal(calls[1].args.p_actual_credits, 30);
    assert.equal(calls[1].args.p_provider_request_id, 'gen-1');
    response = { ...response, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ pages: [{ path: 'raw/sources/source.md', content: 'overwrite' }] }) } }] };
    await assert.rejects(mod.generateWikiWithOpenRouter(input), /invalid wiki page/);
    assert.equal(calls.at(-1).args.p_status, 'completed', 'invalid content still has an actual provider cost');
    response = { ...response, usage: {} };
    await assert.rejects(mod.generateWikiWithOpenRouter(input), /usage could not be confirmed/);
    assert.equal(calls.at(-1).args.p_status, 'uncertain');
  } finally {
    global.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = priorKey;
  }
});
