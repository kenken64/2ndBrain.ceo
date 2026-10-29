const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
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
const generator = compile('lib/chat-pptx-generation.ts');
let user = 'alice', saved, failSave = false;
const mocks = {
  '@/lib/chat-attachments': attachments,
  '@/lib/chat-files': { saveChatGeneratedPptx: async (_admin, owner, source, name, bytes) => { if (failSave) throw new Error('offline'); saved = { owner, source, name, bytes }; return { id: 'saved-id', name }; } },
  '@/lib/env': { hasSupabaseEnv: () => true }, '@/lib/onboarding': { getUserIdFromClaims: c => c?.sub },
  '@/lib/supabase/admin': { createAdminClient: () => ({}), hasSupabaseServiceRoleEnv: () => true },
  '@/lib/supabase/server': { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: user ? { sub: user } : null }, error: null }) } }) }
};
const route = compile('app/api/chat/recover-pptx/route.ts', mocks);
const request = (bytes, origin = 'http://localhost', contentType = 'application/octet-stream') => new Request('http://localhost/api/chat/recover-pptx', { method: 'POST', headers: { 'content-type': contentType, host: 'localhost', origin }, body: bytes });
test('recovery saves the existing presentation for its owner without an AI request', async () => {
  const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../test-data/test-13/sample-slide-content.json'), 'utf8'));
  const bytes = await generator.renderChatPresentation(data);
  user = null; assert.equal((await route.POST(request(bytes))).status, 401);
  user = 'alice'; assert.equal((await route.POST(request(bytes, 'https://other.example'))).status, 403);
  assert.equal((await route.POST(request(bytes, 'http://localhost', 'application/json'))).status, 400);
  assert.equal((await route.POST(request(Buffer.from('not a presentation')))).status, 400);
  const response = await route.POST(request(bytes)); assert.equal(response.status, 201); assert.equal((await response.json()).file.id, 'saved-id');
  assert.equal(saved.owner, 'alice'); assert.equal(saved.source, null); assert.deepEqual(saved.bytes, bytes);
  failSave = true; assert.equal((await route.POST(request(bytes))).status, 503); failSave = false;
});

test('a user with no remaining AI credits can save a recovered presentation', async () => {
  const { NextRequest } = require('next/server');
  const proxy = compile('proxy.ts', {
    '@/lib/env': { getSupabaseEnv: () => ({ supabaseUrl: 'https://example.test' }) },
    '@/lib/url': { appUrl: (url, request) => new URL(url, request.url) },
    '@/lib/supabase/proxy': { updateSession: async (_request, options) => options.onAuthenticated({ email: null, userId: 'user-1', response: new Response('allowed'), supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { llm_token_quota: 10, llm_token_used: 10 } }) }) }) }) } }) }
  }).proxy;
  assert.equal((await proxy(new NextRequest('http://localhost/api/chat/recover-pptx', { method: 'POST' }))).status, 200);
  assert.equal((await proxy(new NextRequest('http://localhost/api/chat', { method: 'POST' }))).status, 402);
});
