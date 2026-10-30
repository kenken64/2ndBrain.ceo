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
  let response = { id: 'gen-1', usage: { cost: 0.00012, prompt_tokens: 100, completion_tokens: 25 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ source_integrity_check: "Repeat these four fictional names exactly, without changes: Maya Chen, Alex Tan, Priya Rao, Sam Lee.", pages: [{ path: 'wiki/entities/maya.md', content: '# Maya' }] }) } }] };
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
    response = { ...response, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ source_integrity_check: "Repeat these four fictional names exactly, without changes: Maya Chen, Alex Tan, Priya Rao, Sam Lee.", pages: [{ path: 'raw/sources/source.md', content: 'overwrite' }] }) } }] };
    await assert.rejects(mod.generateWikiWithOpenRouter(input), /No AI credits were charged/);
    assert.equal(calls.at(-1).args.p_status, 'failed');
    assert.equal(calls.at(-1).args.p_actual_credits, 0);
    assert.equal(calls.at(-1).args.p_cost_usd, 0.00012, 'provider cost is still recorded');
    response = { ...response, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ source_integrity_check: 'Repeat these four fictional names exactly, without changes: Maya Chen, Alex Tan, Priya Rao, Sam Lee.', pages: [{ path: 'wiki/entities/maya.md', content: '# Maya' }] }) } }] };
    await assert.rejects(mod.generateWikiWithOpenRouter({ ...input, protectedPaths: ['wiki/entities/maya.md'], validatePages: () => { throw new Error('wiki_page_conflict'); } }), /generated page conflicts.*No AI credits were charged/);
    assert.equal(calls.at(-1).args.p_status, 'failed');
    assert.equal(calls.at(-1).args.p_actual_credits, 0);
    assert.equal(calls.at(-1).args.p_cost_usd, 0.00012);
    assert.match(JSON.stringify(requests.at(-1).messages), /protectedPaths/);
    response = { ...response, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ source_integrity_check: '[PERSON_NAME]', pages: [{ path: 'wiki/entities/name.md', content: '# Incorrect' }] }) } }] };
    await assert.rejects(mod.generateWikiWithOpenRouter(input), /guardrails may be redacting names/);
    assert.equal(calls.at(-1).args.p_status, 'failed');
    assert.equal(calls.at(-1).args.p_actual_credits, 0);
    response = { ...response, usage: {} };
    await assert.rejects(mod.generateWikiWithOpenRouter(input), /usage could not be confirmed/);
    assert.equal(calls.at(-1).args.p_status, 'uncertain');
  } finally {
    global.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = priorKey;
  }
});


test('wiki pages accept human-readable names but cannot escape or overwrite raw sources', () => {
  const mod = load({ '@/lib/admin': {}, '@/lib/chat-models': {}, '@/lib/supabase/admin': {}, '@/lib/token-quota-redis': {} });
  const pages = mod.validateWikiDraftPages({ pages: [
    { path: './wiki/entities/Maya Chen.md', content: '# Maya' },
    { path: 'wiki-test/wiki/concepts/项目 1.0.md', content: '# 项目' },
    { path: 'Index.md', content: '# Index' },
    { path: 'wiki/sources/notes_2026-10.30.md', content: '# Notes' }
  ] }, 'wiki-test');
  assert.deepEqual(pages.map(page => page.path), ['wiki/entities/Maya Chen.md', 'wiki/concepts/项目 1.0.md', 'index.md', 'wiki/sources/notes_2026-10.30.md']);
  for (const path of ['/wiki/entities/a.md', 'wiki/entities/../../raw/secret.md', 'wiki/entities/../a.md', 'wiki/entities//a.md', 'wiki/entities/.hidden.md', 'wiki/entities/a.md/../b.md', 'raw/sources/a.md', 'wiki\\entities\\a.md', 'wiki/entities/evil\u0000.md']) {
    assert.throws(() => mod.validateWikiDraftPages({ pages: [{ path, content: '# Data' }] }, 'wiki-test'), /invalid_wiki_path/, path);
  }
  assert.throws(() => mod.validateWikiDraftPages({ pages: [{ path: 'wiki/entities/a.md', content: 'x' }, { path: './wiki/entities/A.md', content: 'y' }] }), /duplicate_wiki_path/);
});
