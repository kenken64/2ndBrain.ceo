const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript'), PizZip = require('pizzip');
const { PDFDocument } = require('pdf-lib');
function compile(file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', file), instance = new Module(filename, module);
  instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = Module._load;
  try { Module._load = function(name, ...args) { return Object.hasOwn(mocks, name) ? mocks[name] : original.call(this, name, ...args); }; instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename); }
  finally { Module._load = original; }
  return instance.exports;
}
const shared = compile('lib/chat-files-shared.ts');
const attachments = compile('lib/chat-attachments.ts', { '@/lib/chat-files-shared': shared });
const pdfBatch = compile('lib/chat-pdf-batch.ts');
const wordBatch = compile('lib/chat-docx-batch.ts', { '@/lib/chat-attachments': attachments, '@/lib/chat-pdf-batch': pdfBatch });
const client = compile('lib/chat-batch-client.ts');
const dir = path.resolve(__dirname, '../test-data/test-11');
const fake = (name, type, mime) => ({ file: { name, type, mime, data: fs.readFileSync(path.join(dir, name)) }, metadata: { id: name, origin: 'upload' } });
const files = { pdf: fake('registration-form.pdf', 'pdf', 'application/pdf'), docx: fake('registration-template.docx', 'document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), csv: fake('attendees-mapping.csv', 'spreadsheet', 'text/csv') };
let user = 'alice', outputs = [];
const env = { '@/lib/env': { hasSupabaseEnv: () => true }, '@/lib/onboarding': { getUserIdFromClaims: c => c?.sub }, '@/lib/supabase/admin': { createAdminClient: () => ({}), hasSupabaseServiceRoleEnv: () => true }, '@/lib/supabase/server': { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: user ? { sub: user } : null }, error: null }) } }) } };
const mocks = { ...env, '@/lib/chat-attachments': attachments, '@/lib/chat-pdf-batch': pdfBatch, '@/lib/chat-docx-batch': wordBatch, '@/lib/chat-files': { loadChatFile: async (_, owner, id) => owner === 'alice' ? files[id] ?? outputs.find(item => item.metadata.id === id) ?? null : null, saveChatGeneratedPdf: save, saveChatGeneratedDocx: save, saveChatGeneratedPptx: save } };
async function save(_admin, owner, source, name, data) { assert.equal(owner, 'alice'); assert.ok(source); const id = `out-${outputs.length + 1}`; outputs.push({ file: { name, data }, metadata: { id, origin: 'output' } }); return { id, name }; }
const review = compile('app/api/chat/batch-review/route.ts', mocks);
const zipRoute = compile('app/api/chat/batch-download/route.ts', mocks);
const post = (body, origin = 'http://localhost') => new Request('http://localhost/api/chat/batch-review', { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost', origin }, body: JSON.stringify(body) });
const zipPost = (ids, origin = 'http://localhost') => new Request('http://localhost/api/chat/batch-download', { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost', origin }, body: JSON.stringify({ fileIds: ids }) });
const mappings = [ { field: 'Full Name', column: 'Attendee' }, { field: 'Email', column: 'Email Address' }, { field: 'Company', column: 'Organization' }, { field: 'Course', column: 'Course' }, { field: 'Session Date', column: 'Session Date' } ];

test('review requires ownership and generates only after reviewed mapping, with genuine row progress', async () => {
  outputs = []; user = null; assert.equal((await review.POST(post({ action: 'review', fileIds: ['pdf','csv'] }))).status, 401);
  user = 'bob'; assert.equal((await review.POST(post({ action: 'review', fileIds: ['pdf','csv'] }))).status, 404);
  user = 'alice'; assert.equal((await review.POST(post({ action: 'review', fileIds: ['pdf','csv'] }, 'http://other'))).status, 403);
  const initial = await review.POST(post({ action: 'review', fileIds: ['pdf','csv'] })), body = await initial.json();
  assert.equal(initial.status, 200); assert.equal(body.rowCount, 3); assert.equal(outputs.length, 0);
  assert.equal(body.mappings.find(item => item.field === 'Full Name').column, null);
  assert.equal(body.mappings.find(item => item.field === 'Course').column, 'Course');
  assert.equal(JSON.stringify(body).includes('Alice Tan'), false);
  assert.equal((await review.POST(post({ action: 'run', fileIds: ['pdf','csv'], mappings: [{ field: 'Email', column: 'invented' }] }))).status, 400);
  const response = await review.POST(post({ action: 'run', fileIds: ['pdf','csv'], mappings }));
  const progress = [], result = await client.readBatchProgress(response, item => progress.push(item));
  assert.equal(result.progress.processed, 3); assert.equal(result.progress.succeeded, 2); assert.deepEqual(result.progress.failed.map(item => item.row), [3]); assert.match(result.progress.failed[0].error, /100-character/);
  assert.deepEqual(progress.filter(item => item.processed).map(item => item.processed), [1,2,3,3]);
  const pdf = await PDFDocument.load(outputs[0].file.data); assert.equal(pdf.getForm().getTextField('Full Name').getText(), 'Alice Tan');
  assert.equal(pdf.getForm().getTextField('Company').getText(), 'Northstar Labs');
  assert.equal((await zipRoute.POST(zipPost(['out-1','out-2'], 'http://other'))).status, 403);
  const zip = await zipRoute.POST(zipPost(['out-1','out-2'])); assert.equal(zip.status, 200); assert.equal(zip.headers.get('content-type'), 'application/zip');
  const archive = new PizZip(Buffer.from(await zip.arrayBuffer())); assert.equal(Object.keys(archive.files).length, 2); assert.ok(archive.file('registration-form-row-2.pdf'));
  user = 'bob'; assert.equal((await zipRoute.POST(zipPost(['out-1']))).status, 404); user = 'alice';
  assert.equal((await zipRoute.POST(zipPost(['out-1','out-1']))).status, 400);
});

test('reviewed DOCX batch fills placeholders and preserves embedded media', async () => {
  outputs = []; user = 'alice';
  const initial = await review.POST(post({ action: 'review', fileIds: ['docx','csv'] })); assert.equal((await initial.json()).rowCount, 3);
  const result = await client.readBatchProgress(await review.POST(post({ action: 'run', fileIds: ['docx','csv'], mappings })), () => {});
  assert.equal(result.progress.succeeded, 3); assert.equal(result.progress.failed.length, 0);
  const zip = new PizZip(outputs[0].file.data); const xml = zip.file('word/document.xml').asText();
  assert.match(xml, /Alice Tan/); assert.match(xml, /Northstar Labs/); assert.ok(Object.keys(zip.files).some(name => name.startsWith('word/media/') && !zip.files[name].dir));
});

test('interrupted batch stream reports that already saved files may exist', async () => {
  const response = new Response('{"type":"start","total":2}\n{"type":"row","row":2,"status":"succeeded","file":{"id":"x","name":"a.pdf"}}\n');
  await assert.rejects(client.readBatchProgress(response, () => {}), /Check My files/);
});

test('ZIP uses safe unique names and refuses uploads or another user’s files', async () => {
  user = 'alice'; outputs = [
    { file: { name: '../same.pdf', data: Buffer.from('first') }, metadata: { id: 'first', origin: 'output' } },
    { file: { name: '../same.pdf', data: Buffer.from('second') }, metadata: { id: 'second', origin: 'output' } }
  ];
  const response = await zipRoute.POST(zipPost(['first', 'second']));
  const zip = new PizZip(Buffer.from(await response.arrayBuffer()));
  assert.deepEqual(Object.keys(zip.files).sort(), ['2-_same.pdf', '_same.pdf']);
  assert.equal((await zipRoute.POST(zipPost(['csv']))).status, 404);
  user = 'bob'; assert.equal((await zipRoute.POST(zipPost(['first']))).status, 404); user = 'alice';
});
