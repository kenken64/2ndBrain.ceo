const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { PDFDocument, PDFName, PDFString } = require('pdf-lib');

function compile(file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', file), instance = new Module(filename, module);
  instance.filename = filename; instance.paths = module.paths;
  const original = Module._load;
  try { Module._load = function(request, ...args) { return Object.hasOwn(mocks, request) ? mocks[request] : original.call(this, request, ...args); }; instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename); }
  finally { Module._load = original; }
  return instance.exports;
}
const batch = compile('lib/chat-pdf-batch.ts');
const sampleData = JSON.stringify({ sheets: [{ name: 'People', rowNumbers: [1, 2, 5], rows: [['Name', 'Active', 'Role'], ['Alice', 'yes', 'Staff'], ['Bob', 'no', 'Admin']] }] });
async function template() {
  const doc = await PDFDocument.create(), page = doc.addPage();
  const form = doc.getForm();
  form.createTextField('FullName').addToPage(page, { x: 20, y: 100, width: 200, height: 20 });
  form.createCheckBox('Enabled').addToPage(page, { x: 20, y: 140, width: 20, height: 20 });
  const dropdown = form.createDropdown('Role'); dropdown.addOptions(['Staff', 'Admin']); dropdown.addToPage(page, { x: 20, y: 180, width: 100, height: 20 });
  return Buffer.from(await doc.save());
}

test('maps spreadsheet columns and renders one correct fillable PDF per row', async () => {
  const pdf = await template();
  const data = await batch.preparePdfBatch(pdf, sampleData);
  assert.deepEqual(data.rows.map(row => row.number), [2, 5]);
  const mapping = batch.validateBatchMapping({ mappings: [{ field: 'FullName', column: 'Name' }, { field: 'Enabled', column: 'Active' }, { field: 'Role', column: 'Role' }] }, data);
  for (const [index, name, enabled, role] of [[0, 'Alice', true, 'Staff'], [1, 'Bob', false, 'Admin']]) {
    const result = await PDFDocument.load(await batch.renderPdfRow(pdf, data, mapping, data.rows[index]));
    assert.equal(result.getForm().getTextField('FullName').getText(), name);
    assert.equal(result.getForm().getCheckBox('Enabled').isChecked(), enabled);
    assert.deepEqual(result.getForm().getDropdown('Role').getSelected(), [role]);
  }
  assert.throws(() => batch.validateBatchMapping({ mappings: [{ field: 'FullName', column: 'invented' }] }, data), /invalid field mapping/i);
  assert.throws(() => batch.validateBatchMapping({ mappings: [{ field: 'FullName', column: 'Name' }] }, data), /could not be mapped/i);
  await assert.rejects(batch.renderPdfRow(pdf, data, mapping, { number: 7, values: ['X', 'maybe', 'Staff'] }), /yes\/no/);
  const tooMany = JSON.stringify({ sheets: [{ rows: [['Name'], ...Array.from({ length: 101 }, () => ['A'])] }] });
  await assert.rejects(batch.preparePdfBatch(pdf, tooMany), /at most 100/);
  const plain = await PDFDocument.create(); plain.addPage();
  await assert.rejects(batch.preparePdfBatch(Buffer.from(await plain.save()), sampleData), /no fillable/);
  const xfa = await PDFDocument.create(); xfa.addPage(); const xfaForm = xfa.getForm(); xfaForm.createTextField('Name'); xfaForm.acroForm.dict.set(PDFName.of('XFA'), PDFString.of('dynamic'));
  await assert.rejects(batch.preparePdfBatch(Buffer.from(await xfa.save({ updateFieldAppearances: false })), sampleData), /XFA/);
});

test('batch endpoint checks ownership, records AI cost and stores each generated PDF', async () => {
  let user = 'alice', state;
  const templateBytes = await template();
  const loaded = {
    pdf: { file: { type: 'pdf', name: 'template.pdf', data: templateBytes }, metadata: { id: 'pdf', origin: 'upload' } },
    sheet: { file: { type: 'spreadsheet', name: 'people.csv', data: Buffer.from('x') }, metadata: { id: 'sheet', origin: 'upload' } }
  };
  const admin = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { email: 'alice@example.test', openclaw_instance: null }, error: null }) }) }) }),
    rpc: (name, args) => ({ single: async () => { state.rpc.push({ name, args }); return { data: { request_id: 'req-1', llm_token_quota: 10000, llm_token_used: 20, charged_credits: args.p_actual_credits ?? 0 }, error: null }; } })
  };
  const models = compile('lib/chat-models.ts');
  const mocks = {
    '@/lib/chat-attachments': { spreadsheetContext: async () => sampleData },
    '@/lib/chat-files': { loadChatFile: async (_admin, owner, id) => owner === 'alice' ? loaded[id] ?? null : null, saveChatGeneratedPdf: async (_admin, owner, source, name, bytes) => { assert.equal(owner, 'alice'); assert.equal(source, 'pdf'); if (state.failRow && name.includes('row-2')) throw Error('storage failed'); state.pdfs.push({ name, bytes }); return { id: `file-${state.pdfs.length}`, name }; } },
    '@/lib/chat-pdf-batch': batch, '@/lib/chat-docx-batch': {}, '@/lib/chat-models': models, '@/lib/admin': { isAdminUser: async () => false }, '@/lib/env': { hasSupabaseEnv: () => true }, '@/lib/onboarding': { getUserIdFromClaims: c => c?.sub },
    '@/lib/supabase/admin': { createAdminClient: () => admin, hasSupabaseServiceRoleEnv: () => true }, '@/lib/supabase/server': { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: user ? { sub: user } : null }, error: null }) } }) }, '@/lib/token-quota-redis': { publishTokenQuotaUpdate: async () => true }
  };
  const route = compile('app/api/chat/batch-pdf/route.ts', mocks);
  const oldFetch = global.fetch, oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';
  global.fetch = async url => String(url).endsWith('/models') ? Response.json({ data: [{ id: models.FILE_CHAT_MODEL, pricing: { prompt: '0.000001', completion: '0.000002' } }] }) : Response.json({ id: 'gen-1', usage: { cost: 0.001, prompt_tokens: 10, completion_tokens: 20 }, choices: [{ message: { content: JSON.stringify({ mappings: state.badMapping ? [{ field: 'FullName', column: 'unknown' }] : [{ field: 'FullName', column: 'Name' }, { field: 'Enabled', column: 'Active' }, { field: 'Role', column: 'Role' }] }) } }] });
  const request = ids => new Request('http://localhost/api/chat/batch-pdf', { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost', origin: 'http://localhost' }, body: JSON.stringify({ fileIds: ids, messages: [{ role: 'user', content: 'Fill the forms' }] }) });
  try {
    state = { rpc: [], pdfs: [] }; user = null; assert.equal((await route.POST(request(['pdf','sheet']))).status, 401); assert.equal(state.rpc.length, 0);
    user = 'bob'; assert.equal((await route.POST(request(['pdf','sheet']))).status, 404); assert.equal(state.rpc.length, 0);
    user = 'alice'; const response = await route.POST(request(['pdf','sheet'])); const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.savedOutputs.length, 2); assert.match(body.message, /Field mapping/);
    assert.equal(state.rpc[0].args.p_kind, 'pdf_generation'); assert.equal(state.rpc[1].args.p_cost_usd, 0.001); assert.equal(state.rpc[1].args.p_actual_credits, 250);
    const second = await PDFDocument.load(state.pdfs[1].bytes); assert.equal(second.getForm().getTextField('FullName').getText(), 'Bob');
    state = { rpc: [], pdfs: [], badMapping: true }; const bad = await route.POST(request(['pdf','sheet']));
    assert.equal(bad.status, 422); assert.equal(state.pdfs.length, 0); assert.equal(state.rpc[1].args.p_status, 'completed'); assert.match((await bad.json()).error, /mapping request was billed/i);
    state = { rpc: [], pdfs: [], failRow: true }; const partial = await route.POST(request(['pdf','sheet'])); const partialBody = await partial.json();
    assert.equal(partial.status, 200); assert.equal(partialBody.savedOutputs.length, 1); assert.equal(partialBody.batchSaveIncomplete, true); assert.match(partialBody.message, /Saved 1 of 2/);
  } finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey; }
});
