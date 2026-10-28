const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const PizZip = require('pizzip');
const mammoth = require('mammoth');

function compile(file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', file), instance = new Module(filename, module);
  instance.filename = filename; instance.paths = module.paths;
  const original = Module._load;
  try { Module._load = function(request, ...args) { return Object.hasOwn(mocks, request) ? mocks[request] : original.call(this, request, ...args); }; instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename); }
  finally { Module._load = original; }
  return instance.exports;
}
const attachments = compile('lib/chat-attachments.ts', { '@/lib/chat-files-shared': { CHAT_FILE_MAX_BYTES: 20 * 1024 * 1024 } });
const pdf = compile('lib/chat-pdf-batch.ts');
const docx = compile('lib/chat-docx-batch.ts', { '@/lib/chat-attachments': attachments, '@/lib/chat-pdf-batch': pdf });
function template(body) {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}
const file = data => ({ name: 'template.docx', type: 'document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data });
const table = JSON.stringify({ sheets: [{ rows: [['Full Name', 'City'], ['Alice & Bob', '新加坡'], ['Maya', 'London']], rowNumbers: [1, 2, 4] }] });

test('renders one editable DOCX for each spreadsheet row, including split placeholders and Unicode', async () => {
  const bytes = template('<w:p><w:r><w:t>Dear {{Na</w:t></w:r><w:r><w:t>me}}, city {{City}}</w:t></w:r></w:p>');
  const data = await docx.prepareDocxBatch(file(bytes), table);
  assert.deepEqual(data.fields.map(field => field.name), ['Name', 'City']);
  const mapping = pdf.validateBatchMapping({ mappings: [{ field: 'Name', column: 'Full Name' }, { field: 'City', column: 'City' }] }, data);
  const first = docx.renderDocxRow(bytes, data, mapping, data.rows[0]);
  const text = (await mammoth.extractRawText({ buffer: first })).value;
  assert.match(text, /Alice & Bob/); assert.match(text, /新加坡/); assert.doesNotMatch(text, /\{\{/);
  const second = docx.renderDocxRow(bytes, data, mapping, data.rows[1]);
  assert.match((await mammoth.extractRawText({ buffer: second })).value, /Maya, city London/);
  assert.equal(data.rows[1].number, 4);
});

test('rejects unsafe template expressions, raw XML, loops, missing tags and oversized archives', async () => {
  for (const tag of ['{{@danger}}', '{{#Name}}{{Name}}{{/Name}}', '{{__proto__}}']) {
    const data = template(`<w:p><w:r><w:t>${tag}</w:t></w:r></w:p>`);
    await assert.rejects(docx.prepareDocxBatch(file(data), table), /simple|placeholder/i);
  }
  await assert.rejects(docx.prepareDocxBatch(file(template('<w:p><w:r><w:t>No fields</w:t></w:r></w:p>')), table), /no placeholders/i);
  const largeZip = new PizZip(template('<w:p><w:r><w:t>{{Name}}</w:t></w:r></w:p>'));
  largeZip.file('word/large.xml', 'a'.repeat(26 * 1024 * 1024));
  await assert.rejects(docx.prepareDocxBatch(file(largeZip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })), table), /25 MB limit/);
});

test('DOCX batch endpoint tracks model cost and saves generated Word documents for the owner', async () => {
  const model = compile('lib/chat-models.ts');
  const bytes = template('<w:p><w:r><w:t>Dear {{Name}}, city {{City}}</w:t></w:r></w:p>');
  const loaded = { doc: { file: file(bytes), metadata: { id: 'doc', origin: 'upload' } }, sheet: { file: { type: 'spreadsheet', name: 'people.csv', data: Buffer.from('fixture') }, metadata: { id: 'sheet', origin: 'upload' } } };
  let owner = 'alice', state = { rpc: [], outputs: [], providerBody: null };
  const admin = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { email: null, openclaw_instance: null }, error: null }) }) }) }),
    rpc: (name, args) => ({ single: async () => { state.rpc.push({ name, args }); return { data: { request_id: 'req-1', llm_token_quota: 10000, llm_token_used: 50, charged_credits: args.p_actual_credits ?? 0 }, error: null }; } })
  };
  const mocks = {
    '@/lib/chat-attachments': { spreadsheetContext: async () => table }, '@/lib/chat-pdf-batch': pdf, '@/lib/chat-docx-batch': docx, '@/lib/chat-models': model,
    '@/lib/chat-files': { loadChatFile: async (_admin, user, id) => user === 'alice' ? loaded[id] ?? null : null, saveChatGeneratedDocx: async (_admin, user, source, name, data) => { assert.equal(user, 'alice'); assert.equal(source, 'doc'); state.outputs.push({ name, data }); return { id: `file-${state.outputs.length}`, name }; } },
    '@/lib/admin': { isAdminUser: async () => false }, '@/lib/env': { hasSupabaseEnv: () => true }, '@/lib/onboarding': { getUserIdFromClaims: claims => claims?.sub },
    '@/lib/supabase/admin': { createAdminClient: () => admin, hasSupabaseServiceRoleEnv: () => true }, '@/lib/supabase/server': { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: owner } }, error: null }) } }) }, '@/lib/token-quota-redis': { publishTokenQuotaUpdate: async () => true }
  };
  const route = compile('app/api/chat/batch-pdf/route.ts', mocks);
  const oldFetch = global.fetch, oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';
  global.fetch = async (url, options) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: model.FILE_CHAT_MODEL, pricing: { prompt: '0.000001', completion: '0.000002' } }] });
    state.providerBody = JSON.parse(options.body);
    return Response.json({ id: 'gen-1', usage: { cost: 0.001, prompt_tokens: 10, completion_tokens: 20 }, choices: [{ message: { content: JSON.stringify({ mappings: [{ field: 'Name', column: 'Full Name' }, { field: 'City', column: 'City' }] }) } }] });
  };
  const request = () => new Request('http://localhost/api/chat/batch-pdf', { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost', origin: 'http://localhost' }, body: JSON.stringify({ fileIds: ['doc', 'sheet'], messages: [{ role: 'user', content: 'Fill the template' }] }) });
  try {
    owner = 'bob'; assert.equal((await route.POST(request())).status, 404); assert.equal(state.rpc.length, 0);
    owner = 'alice'; const response = await route.POST(request()); const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.savedOutputs.length, 2); assert.match(body.savedOutputs[0].name, /row-2\.docx$/);
    assert.equal(state.rpc[0].args.p_kind, 'docx_generation'); assert.equal(state.rpc[1].args.p_cost_usd, 0.001); assert.equal(state.rpc[1].args.p_actual_credits, 250);
    assert.equal(JSON.stringify(state.providerBody).includes('Alice & Bob'), false);
    assert.match((await mammoth.extractRawText({ buffer: state.outputs[0].data })).value, /Alice & Bob, city 新加坡/);
  } finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey; }
});
