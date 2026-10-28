const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

test('usage requires authentication, scopes rows to the caller, and pages results', async () => {
  let authenticated = true, requestedUser = null, from = null, to = null;
  const client = {
    auth: { getClaims: async () => ({ data: { claims: authenticated ? { sub: 'alice' } : null }, error: null }) },
    rpc: async () => ({ data: [{ request_kind: 'chat', completed_credits: 25 }], error: null }),
    from(table) {
      if (table === 'profiles') return { select: () => ({ eq: (_k, id) => ({ maybeSingle: async () => ({ data: { llm_token_quota: 100, llm_token_used: 40 }, error: null }) }) }) };
      return { select: () => ({ eq: (_key, id) => { requestedUser = id; return { order: () => ({ order: () => ({ range: async (a, b) => { from = a; to = b; return { data: Array.from({ length: 21 }, (_, i) => ({ id: String(i) })), error: null }; } }) }) }; } }) };
    }
  };
  const replacements = { '@/lib/admin': { isAdminUser: async () => false }, '@/lib/env': { hasSupabaseEnv: () => true }, '@/lib/onboarding': { getUserIdFromClaims: claims => claims?.sub }, '@/lib/supabase/server': { createClient: async () => client } };
  const filename = path.resolve(__dirname, '../app/api/chat/usage/route.ts');
  const instance = new Module(filename, module); instance.filename = filename; instance.paths = module.paths;
  const original = Module._load;
  try { Module._load = function (request, ...args) { return request in replacements ? replacements[request] : original.call(this, request, ...args); }; instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename); }
  finally { Module._load = original; }
  authenticated = false;
  assert.equal((await instance.exports.GET(new Request('http://localhost/api/chat/usage'))).status, 401);
  authenticated = true;
  assert.equal((await instance.exports.GET(new Request('http://localhost/api/chat/usage?page=-1'))).status, 400);
  const response = await instance.exports.GET(new Request('http://localhost/api/chat/usage?page=2&user=bob'));
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(requestedUser, 'alice'); assert.equal(from, 20); assert.equal(to, 40);
  assert.equal(body.items.length, 20); assert.equal(body.hasMore, true); assert.equal(body.availableCredits, 60); assert.equal(body.quotaExempt, false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
