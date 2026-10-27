const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

function compile(file) {
  const filename = path.resolve(__dirname, "..", file);
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = module.paths;
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  instance._compile(output, filename);
  return instance.exports;
}

test("chat API checks authentication, model, billing and uncertain failures", async () => {
  const models = compile("lib/chat-models.ts");
  let state;
  const admin = {
    from() { return { select() { return { eq() { return { maybeSingle: async () => ({ data: { email: "test@example.test", openclaw_instance: null }, error: null }) }; } }; } }; },
    rpc(name, args) {
      return { single: async () => {
        state.rpc.push({ name, args });
        if (name === "reserve_chat_credits") return state.noCredit
          ? { data: null, error: { message: "insufficient_ai_credits" } }
          : { data: { request_id: "req-1", llm_token_quota: 10000, llm_token_used: 500 }, error: null };
        return { data: { llm_token_quota: 10000, llm_token_used: 250, charged_credits: args.p_actual_credits }, error: null };
      } };
    }
  };
  const replacements = {
    "@/lib/admin": { isAdminUser: async () => false },
    "@/lib/chat-models": models,
    "@/lib/env": { hasSupabaseEnv: () => true },
    "@/lib/onboarding": { getUserIdFromClaims: (claims) => claims?.sub || null },
    "@/lib/supabase/admin": { createAdminClient: () => admin, hasSupabaseServiceRoleEnv: () => true },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: state.auth ? { sub: "user-1", email: "test@example.test" } : null }, error: null }) } }) },
    "@/lib/token-quota-redis": { publishTokenQuotaUpdate: async (event) => { state.notifications.push(event); return true; } }
  };
  const originalLoad = Module._load;
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  let post;
  try {
    Module._load = function (request, parent, isMain) {
      return Object.prototype.hasOwnProperty.call(replacements, request) ? replacements[request] : originalLoad.apply(this, arguments);
    };
    post = compile("app/api/chat/route.ts").POST;
  } finally {
    Module._load = originalLoad;
  }
  global.fetch = async (url, options) => {
    state.urls.push(String(url));
    if (String(url).endsWith("/models")) return Response.json({ data: [{ id: models.CHAT_MODELS[0].id, pricing: { prompt: "0.000002", completion: "0.00001" } }] });
    if (state.mode === "network") throw Error("network");
    if (state.mode === "rate") return Response.json({}, { status: 429 });
    if (state.mode === "missing") return Response.json({ id: "gen-1", choices: [{ message: { content: "hello" } }] });
    state.providerBody = JSON.parse(options.body);
    return Response.json({ id: "gen-1", choices: [{ message: { content: "hello" } }], usage: { cost: 0.0004 } });
  };
  process.env.OPENROUTER_API_KEY = "test-key";
  const request = (body) => new Request("http://localhost:3000/api/chat", { method: "POST", headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" }, body: JSON.stringify(body) });
  const good = { model: models.CHAT_MODELS[0].id, messages: [{ role: "user", content: "Hello" }] };
  const reset = () => { state = { auth: true, rpc: [], urls: [], notifications: [], mode: "ok", noCredit: false }; };
  try {
    reset(); state.auth = false;
    let response = await post(request(good));
    assert.equal(response.status, 401); assert.equal(state.urls.length, 0);
    reset(); response = await post(request({ ...good, model: "evil/model" }));
    assert.equal(response.status, 400); assert.equal(state.urls.length, 0);
    reset(); response = await post(request({ ...good, messages: [{ role: "system", content: "x" }] }));
    assert.equal(response.status, 400); assert.equal(state.rpc.length, 0);
    reset(); state.noCredit = true; response = await post(request(good));
    assert.equal(response.status, 402); assert.equal(state.urls.length, 1);
    reset(); response = await post(request(good));
    const data = await response.json();
    assert.equal(response.status, 200); assert.equal(data.message, "hello"); assert.equal(data.chargedCredits, 100);
    assert.equal(state.rpc[1].args.p_status, "completed"); assert.equal(state.providerBody.model, good.model); assert.equal(state.notifications.length, 2);
    reset(); state.mode = "rate"; response = await post(request(good));
    assert.equal(response.status, 502); assert.equal(state.rpc[1].args.p_status, "failed");
    reset(); state.mode = "network"; response = await post(request(good));
    assert.equal(response.status, 502); assert.equal(state.rpc[1].args.p_status, "uncertain");
    reset(); state.mode = "missing"; response = await post(request(good));
    assert.equal(response.status, 502); assert.equal(state.rpc[1].args.p_status, "uncertain"); assert.equal(state.rpc[1].args.p_provider_request_id, "gen-1");
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
  }
});
