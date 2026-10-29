const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
function compile(file, mocks) {
  const filename = path.resolve(__dirname, '..', file), instance = new Module(filename, module);
  instance.filename = filename; instance.paths = module.paths;
  const original = Module._load;
  try { Module._load = function(request, ...args) { return Object.hasOwn(mocks, request) ? mocks[request] : original.call(this, request, ...args); }; instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename); }
  finally { Module._load = original; }
  return instance.exports;
}
const max = 20 * 1024 * 1024;
const shared = { CHAT_FILE_MAX_BYTES: max };
const attachments = compile('lib/chat-attachments.ts', { '@/lib/chat-files-shared': shared });

test('private file metadata policies isolate users and block direct writes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.user_id', true), '')::uuid $$;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);`);
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/0031_chat_files.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/0032_chat_file_delete_guard.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/0033_chat_file_outputs.sql'), 'utf8'));
    const alice = '00000000-0000-4000-8000-000000000001', bob = '00000000-0000-4000-8000-000000000002';
    await db.query('insert into auth.users values ($1),($2)', [alice, bob]);
    await db.query("insert into chat_files(id,user_id,file_name,object_path,mime_type,size_bytes) values ($1,$2,'a.csv','alice/file','text/csv',1),($3,$4,'b.csv','bob/file','text/csv',1)", [alice, alice, bob, bob]);
    await db.exec(`grant usage on schema public,auth to authenticated; set test.user_id = '${alice}'; set role authenticated`);
    const result = await db.query('select user_id from chat_files'); assert.deepEqual(result.rows.map(row => row.user_id), [alice]);
    await assert.rejects(db.query("delete from chat_files"), /permission denied/);
    await db.exec('reset role');
    await assert.rejects(db.query('delete from auth.users where id=$1', [alice]), /foreign key/);
    const bucket = await db.query("select public,file_size_limit from storage.buckets where id='aicuber-chat-uploads'");
    assert.equal(bucket.rows[0].public, false); assert.equal(Number(bucket.rows[0].file_size_limit), max);
  } finally { await db.close(); }
});

test('file lookup enforces ownership before downloading and validates stored bytes', async () => {
  const id = '00000000-0000-4000-8000-000000000001', alice = 'alice';
  const bytes = Buffer.from('a,b\n1,2\n'); let downloads = 0, queryOwner;
  const row = { id, user_id: alice, file_name: 'test.csv', object_path: `alice/${id}`, mime_type: 'text/csv', size_bytes: bytes.length, created_at: '2026-01-01' };
  const admin = {
    from() { return { select() { return { eq(_key, val) { return { eq(_key2, owner) { queryOwner = owner; return { maybeSingle: async () => ({ data: val === id && owner === alice ? row : null, error: null }) }; } }; } }; } }; },
    storage: { from() { return { download: async () => { downloads++; return { data: new Blob([bytes]), error: null }; } }; } }
  };
  const files = compile('lib/chat-files.ts', { 'server-only': {}, '@/lib/chat-attachments': attachments, '@/lib/supabase/admin': {} });
  assert.equal(await files.loadChatFile(admin, 'bob', id), null); assert.equal(queryOwner, 'bob'); assert.equal(downloads, 0);
  const result = await files.loadChatFile(admin, alice, id); assert.equal(result.file.data.toString(), bytes.toString()); assert.equal(downloads, 1);
  row.file_origin = 'output'; row.mime_type = 'text/markdown'; row.file_name = 'output.md';
  const output = await files.loadChatFile(admin, alice, id); assert.equal(output.file.type, 'output'); assert.equal(output.metadata.origin, 'output');
  row.mime_type = 'application/pdf'; row.file_name = 'output.pdf';
  await assert.rejects(files.loadChatFile(admin, alice, id), /invalid type/);
  row.object_path = 'bob/other'; await assert.rejects(files.loadChatFile(admin, alice, id), /Invalid file record/);
});

test('upload route rejects unauthorized, cross-origin, and oversized requests', async () => {
  let user = 'alice', saved;
  const mocks = { '@/lib/chat-attachments': attachments, '@/lib/chat-files-shared': shared, '@/lib/chat-files': { saveChatFile: async (_admin, owner, file) => { saved = { owner, file }; return { id: 'one', name: file.name, size: file.data.length }; } }, '@/lib/env': { hasSupabaseEnv: () => true }, '@/lib/onboarding': { getUserIdFromClaims: c => c?.sub }, '@/lib/supabase/admin': { createAdminClient: () => ({}), hasSupabaseServiceRoleEnv: () => true }, '@/lib/supabase/server': { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: user ? { sub: user } : null }, error: null }) } }) } };
  const route = compile('app/api/chat/files/route.ts', mocks);
  const make = (data, headers = {}) => new Request('http://localhost/api/chat/files?name=example.csv', { method: 'POST', headers: { 'content-type': 'application/octet-stream', host: 'localhost', origin: 'http://localhost', ...headers }, body: data });
  user = null; assert.equal((await route.POST(make('x'))).status, 401);
  user = 'alice'; assert.equal((await route.POST(make('x', { origin: 'http://attacker.test' }))).status, 403);
  assert.equal((await route.POST(make('x', { 'content-length': String(max + 1) }))).status, 413);
  assert.equal((await route.POST(make('x', { 'content-length': '2' }))).status, 400);
  const response = await route.POST(make('a,b\n1,2')); assert.equal(response.status, 201); assert.equal(saved.owner, 'alice'); assert.equal(saved.file.mime, 'text/csv');
});


test('generated output is stored privately with its owner and source, and failed metadata is cleaned up', async () => {
  const files = compile('lib/chat-files.ts', { 'server-only': {}, '@/lib/chat-attachments': attachments, '@/lib/supabase/admin': {} });
  let uploaded, inserted, removed, fail = false;
  const admin = {
    storage: { from(bucket) { assert.equal(bucket, 'aicuber-chat-uploads'); return {
      upload: async (path, data, options) => { uploaded = { path, data, options }; return { error: null }; },
      remove: async paths => { removed = paths; return { error: null }; }
    }; } },
    from() { return { insert(row) { inserted = row; return { select() { return { single: async () => fail ? { data: null, error: {} } : { data: { ...row, created_at: '2026-01-01' }, error: null } }; } }; } }; }
  };
  const result = await files.saveChatOutput(admin, 'alice', 'source-id', 'report.pdf', 'ocr', '# OCR');
  assert.equal(result.origin, 'output'); assert.equal(result.name, 'report-ocr.md');
  assert.equal(inserted.user_id, 'alice'); assert.equal(inserted.source_file_id, 'source-id'); assert.equal(uploaded.data.toString(), '# OCR'); assert.match(uploaded.path, /^alice\//);
  fail = true;
  await assert.rejects(files.saveChatOutput(admin, 'alice', 'source-id', 'report.pdf', 'ocr', 'text'), /could not be saved/);
  assert.deepEqual(removed, [uploaded.path]);
});

test('generated PDFs are saved as private output files', async () => {
  const files = compile('lib/chat-files.ts', { 'server-only': {}, '@/lib/chat-attachments': attachments, '@/lib/supabase/admin': {} });
  let inserted;
  const admin = { storage: { from: () => ({ upload: async () => ({ error: null }) }) }, from: () => ({ insert: row => { inserted = row; return { select: () => ({ single: async () => ({ data: { ...row, created_at: '2026-01-01' }, error: null }) }) }; } }) };
  const output = await files.saveChatGeneratedPdf(admin, 'alice', 'template-id', 'row-2.pdf', Buffer.from('%PDF-example'));
  assert.equal(output.origin, 'output'); assert.equal(output.mime, 'application/pdf'); assert.equal(inserted.user_id, 'alice'); assert.equal(inserted.source_file_id, 'template-id');
  await assert.rejects(files.saveChatGeneratedPdf(admin, 'alice', 'template-id', 'bad.pdf', Buffer.from('not pdf')), /invalid/);
});

test('generated DOCX files are saved as private output files', async () => {
  const files = compile('lib/chat-files.ts', { 'server-only': {}, '@/lib/chat-attachments': attachments, '@/lib/supabase/admin': {} });
  let inserted;
  const admin = { storage: { from: () => ({ upload: async () => ({ error: null }) }) }, from: () => ({ insert: row => { inserted = row; return { select: () => ({ single: async () => ({ data: { ...row, created_at: '2026-01-01' }, error: null }) }) }; } }) };
  const output = await files.saveChatGeneratedDocx(admin, 'alice', 'template-id', 'row-2.docx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]));
  assert.equal(output.origin, 'output'); assert.match(output.mime, /wordprocessingml/); assert.equal(inserted.user_id, 'alice'); assert.equal(inserted.source_file_id, 'template-id');
  await assert.rejects(files.saveChatGeneratedDocx(admin, 'alice', 'template-id', 'bad.docx', Buffer.from('not docx')), /invalid/);
});

test('preview requires authentication and ownership, and never serves documents as active HTML', async () => {
  let user = null, requestedOwner, saved, invalidArchive = false;
  const mocks = {
    '@/lib/chat-attachments': { checkOfficeArchive: async () => { if (invalidArchive) throw new Error('Invalid archive'); }, presentationText: async () => 'Slide 1\nTest', spreadsheetPreview: async () => ({ sheets: [{ name: 'Sheet1', rows: [['A', '1']] }], truncated: false }) },
    '@/lib/chat-files': { loadChatFile: async (_admin, owner) => { requestedOwner = owner; return saved; } },
    '@/lib/env': { hasSupabaseEnv: () => true },
    '@/lib/onboarding': { getUserIdFromClaims: c => c?.sub },
    '@/lib/supabase/admin': { createAdminClient: () => ({}), hasSupabaseServiceRoleEnv: () => true },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: user ? { sub: user } : null }, error: null }) } }) }
  };
  const route = compile('app/api/chat/files/[id]/preview/route.ts', mocks);
  const params = { params: Promise.resolve({ id: 'file-1' }) };
  const request = (query = '') => new Request('http://localhost/api/chat/files/file-1/preview' + query);
  assert.equal((await route.GET(request(), params)).status, 401);
  user = 'alice'; saved = null;
  assert.equal((await route.GET(request(), params)).status, 404); assert.equal(requestedOwner, 'alice');
  saved = { file: { type: 'document', name: 'report.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: Buffer.from('document') } };
  let response = await route.GET(request(), params); const body = await response.json();
  assert.equal(response.headers.get('content-type'), 'application/json'); assert.equal(body.kind, 'document');
  assert.equal((await route.GET(request('?inline=1'), params)).status, 400);
  invalidArchive = true; assert.equal((await route.GET(request(), params)).status, 422); invalidArchive = false;
  saved = { file: { type: 'pdf', name: 'report.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-') } };
  response = await route.GET(request('?inline=1'), params);
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-disposition'), 'inline'); assert.match(response.headers.get('content-security-policy'), /sandbox/); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  saved = { file: { type: 'output', name: 'generated.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-') } };
  response = await route.GET(request(), params); assert.equal((await response.json()).kind, 'pdf');
  assert.equal((await route.GET(request('?inline=1'), params)).status, 200);
  saved = { file: { type: 'output', name: 'generated.png', mime: 'image/png', data: Buffer.from('image') } };
  response = await route.GET(request(), params); assert.equal((await response.json()).kind, 'image');
  response = await route.GET(request('?inline=1'), params); assert.equal(response.headers.get('content-type'), 'image/png');
  saved = { file: { type: 'output', name: 'generated.mp4', mime: 'video/mp4', data: Buffer.from('video') } };
  response = await route.GET(request(), params); assert.equal((await response.json()).kind, 'video');
  response = await route.GET(request('?inline=1'), params); assert.equal(response.headers.get('content-type'), 'video/mp4'); assert.equal(response.headers.get('accept-ranges'), 'bytes'); assert.equal(response.headers.get('content-length'), '5');
  const ranged = range => new Request('http://localhost/api/chat/files/file-1/preview?inline=1', { headers: { range } });
  response = await route.GET(ranged('bytes=1-3'), params); assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 1-3/5'); assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'ide');
  response = await route.GET(ranged('bytes=2-'), params); assert.equal(response.status, 206); assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'deo');
  response = await route.GET(ranged('bytes=-2'), params); assert.equal(response.status, 206); assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'eo');
  response = await route.GET(ranged('bytes=0-500'), params); assert.equal(response.headers.get('content-range'), 'bytes 0-4/5');
  for (const range of ['bytes=5-', 'bytes=3-1', 'bytes=-0', 'bytes=0-1,3-4', 'bytes=99999999999999999999-']) { response = await route.GET(ranged(range), params); assert.equal(response.status, 416); assert.equal(response.headers.get('content-range'), 'bytes */5'); }
  user = null; assert.equal((await route.GET(ranged('bytes=0-1'), params)).status, 401); user = 'alice';
  saved = { file: { type: 'output', name: 'generated.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: Buffer.from('fixture') } };
  response = await route.GET(request(), params); assert.equal((await response.json()).kind, 'document');
  saved = { file: { type: 'output', name: 'generated.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', data: Buffer.from('fixture') } };
  response = await route.GET(request(), params); const presentation = await response.json(); assert.equal(presentation.kind, 'presentation'); assert.match(presentation.text, /Slide 1/);
  saved = { file: { type: 'spreadsheet', name: 'report.xlsx', data: Buffer.from('sheet') } };
  response = await route.GET(request(), params); assert.equal((await response.json()).sheets[0].rows[0][0], 'A');
});

test('generated media is validated and stored privately for its owner', async () => {
  const files = compile('lib/chat-files.ts', { 'server-only': {}, '@/lib/chat-attachments': attachments, '@/lib/supabase/admin': {} });
  const rows = [];
  const admin = { storage: { from: () => ({ upload: async () => ({ error: null }) }) }, from: () => ({ insert: row => { rows.push(row); return { select: () => ({ single: async () => ({ data: { ...row, created_at: '2026-01-01' }, error: null }) }) }; } }) };
  const image = await files.saveChatGeneratedImage(admin, 'alice', Buffer.from([137,80,78,71,13,10,26,10,1]), 'image/png');
  assert.equal(image.origin, 'output'); assert.equal(image.mime, 'image/png'); assert.equal(rows[0].user_id, 'alice'); assert.equal(rows[0].source_file_id, null);
  await assert.rejects(files.saveChatGeneratedImage(admin, 'alice', Buffer.from('not png'), 'image/png'), /Choose|invalid/i);
  const video = await files.saveChatGeneratedVideo(admin, 'bob', Buffer.from('0000ftypmp42'));
  assert.equal(video.mime, 'video/mp4'); assert.equal(rows[1].user_id, 'bob'); assert.equal(rows[1].source_file_id, null);
  await assert.rejects(files.saveChatGeneratedVideo(admin, 'bob', Buffer.from('not video')), /invalid/i);
});
