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
        if (name === "reserve_chat_credits_itemized") return state.noCredit
          ? { data: null, error: { message: "insufficient_ai_credits" } }
          : { data: { request_id: "req-1", llm_token_quota: 10000, llm_token_used: 500 }, error: null };
        return { data: { llm_token_quota: 10000, llm_token_used: 250, charged_credits: args.p_actual_credits }, error: null };
      } };
    }
  };
  const replacements = {
    "@/lib/admin": { isAdminUser: async () => false },
    "@/lib/chat-files": { saveChatOutput: async (_admin, userId, sourceId, name, kind, content) => { state.savedOutput = { userId, sourceId, name, kind, content }; if (state.outputFail) throw Error("storage unavailable"); return { id: "output-1", name: "output.md", origin: "output" }; }, saveChatFile: async (_admin, userId, file) => ({ id: "file-1", name: file.name, size: file.data.length, mime: file.mime, createdAt: "2026-01-01" }), loadChatFile: async (_admin, userId, id) => id === "owned" && userId === "user-1" ? { file: { name: "scan.pdf", type: "pdf", mime: "application/pdf", data: Buffer.from("fixture") }, metadata: { id: "owned", name: "scan.pdf" } } : null },
    "@/lib/chat-attachments": {
      parseChatAttachment: value => ({ name: value.name, type: value.kind, mime: value.kind === "pdf" ? "application/pdf" : "image/png", data: Buffer.from("fixture") }),
      pdfPageCount: async () => 3,
      spreadsheetContext: async () => '{"sheets":[]}'
    },
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
    if (String(url).endsWith("/models")) return Response.json({ data: models.CHAT_MODELS.map(({ id }) => ({ id, pricing: { prompt: "0.000002", completion: "0.00001" } })) });
    if (String(url).startsWith("https://openrouter.ai/api/v1/generation")) return state.mode === "usage-unavailable" ? Response.json({}, { status: 503 }) : Response.json({ data: { total_cost: 0.0065 } });
    if (state.mode === "network") throw Error("network");
    if (state.mode === "rate") return Response.json({}, { status: 429 });
    if (state.mode === "missing") return Response.json({ id: "gen-1", choices: [{ message: { content: "hello" } }] });
    state.providerBody = JSON.parse(options.body);
    if (state.mode === "image") return Response.json({ id: "gen-image", choices: [{ message: { content: JSON.stringify({ transcription: "# Receipt\nTotal: 42", answer: "The total is 42." }) } }], usage: { cost: 0.0004, prompt_tokens: 40, completion_tokens: 10 } });
    if (state.mode === "invalid-image") return Response.json({ id: "gen-image", choices: [{ message: { content: "not JSON" } }], usage: { cost: 0.0004 } });
    return Response.json({ id: "gen-1", choices: [{ message: { content: "hello", annotations: [{ type: "file", file: { content: [{ type: "text", text: "# Extracted" }] } }] } }], usage: { cost: 0.0004, prompt_tokens: 40, completion_tokens: 10 } });
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
    reset(); response = await post(request({ ...good, attachment: { name: "scan.pdf", kind: "pdf" } }));
    const pdf = await response.json();
    assert.equal(response.status, 200); assert.equal(pdf.ocr.markdown, "# Extracted");
    assert.equal(pdf.savedOutput.id, "output-1"); assert.equal(state.savedOutput.userId, "user-1"); assert.equal(state.savedOutput.sourceId, "file-1"); assert.equal(state.savedOutput.kind, "ocr"); assert.equal(state.savedOutput.content, "# Extracted");
    assert.equal(state.providerBody.plugins[0].pdf.engine, "mistral-ocr"); assert.equal(state.providerBody.model, "google/gemini-2.5-flash");
    assert.match(state.providerBody.messages.at(-1).content[0].text, /First use OCR/); assert.match(state.providerBody.messages.at(-1).content[0].text, /User request: Hello/);
    assert.equal(state.rpc[0].args.p_kind, "pdf_ocr"); assert.equal(state.rpc[0].args.p_pdf_pages, 3);
    assert.equal(state.rpc[1].args.p_cost_usd, 0.0065); assert.equal(state.rpc[1].args.p_prompt_tokens, 40);
    reset(); state.mode = "image"; response = await post(request({ ...good, model: "mistralai/mistral-small-2603", attachment: { name: "receipt.png", kind: "image" } }));
    const image = await response.json();
    assert.equal(response.status, 200); assert.equal(image.ocr.markdown, "# Receipt\nTotal: 42"); assert.equal(image.message, "The total is 42."); assert.equal(state.savedOutput.content, image.ocr.markdown);
    assert.equal(state.providerBody.model, "google/gemini-2.5-flash"); assert.equal(state.providerBody.response_format.type, "json_schema");
    assert.equal(state.providerBody.provider.require_parameters, true); assert.match(state.providerBody.messages.at(-1).content[0].text, /User request: Hello/);
    reset(); state.mode = "image"; state.outputFail = true; response = await post(request({ ...good, attachment: { name: "receipt.png", kind: "image" } }));
    const unsaved = await response.json(); assert.equal(response.status, 200); assert.equal(unsaved.outputSaveFailed, true); assert.equal(unsaved.message, "The total is 42."); assert.equal(state.rpc[1].args.p_status, "completed");
    reset(); response = await post(request({ ...good, attachment: { name: "sales.csv", kind: "spreadsheet" } }));
    const sheet = await response.json(); assert.equal(response.status, 200); assert.equal(sheet.savedOutput.id, "output-1");
    assert.equal(state.savedOutput.kind, "spreadsheet"); assert.equal(JSON.parse(state.savedOutput.content).answer, "hello");
    reset(); state.mode = "invalid-image"; response = await post(request({ ...good, attachment: { name: "receipt.png", kind: "image" } }));
    const invalid = await response.json(); assert.equal(response.status, 200); assert.equal(invalid.ocr, null); assert.match(invalid.message, /could not be displayed/); assert.equal(state.rpc[1].args.p_status, "completed");
    reset(); response = await post(request({ ...good, fileId: "someone-elses-file" }));
    assert.equal(response.status, 404); assert.equal(state.rpc.length, 0);
    reset(); response = await post(request({ ...good, fileId: "owned" }));
    assert.equal(response.status, 200); assert.equal((await response.json()).savedFile.id, "owned");
    reset(); state.mode = "usage-unavailable"; response = await post(request({ ...good, attachment: { name: "scan.pdf", kind: "pdf" } }));
    assert.equal(response.status, 502); assert.equal(state.rpc[1].args.p_status, "uncertain"); assert.equal(state.rpc[1].args.p_provider_request_id, "gen-1");
    reset(); state.mode = "rate"; response = await post(request({ ...good, attachment: { name: "scan.pdf", kind: "pdf" } }));
    assert.equal(response.status, 502); assert.equal(state.rpc[1].args.p_status, "uncertain");
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
