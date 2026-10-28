const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function compile(file, mocks) {
  const filename = path.resolve(__dirname, '..', file), instance = new Module(filename, module);
  instance.filename = filename; instance.paths = module.paths;
  const old = Module._load;
  try { Module._load = function(name, ...args) { return Object.hasOwn(mocks, name) ? mocks[name] : old.call(this, name, ...args); }; instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename); }
  finally { Module._load = old; }
  return instance.exports;
}

test('email auth validates requests and preserves the session and destination', async () => {
  let state;
  const reset = () => { state = { calls: [], authenticated: true }; };
  const supabase = {
    auth: {
      signInWithPassword: async input => { state.calls.push(['login', input]); return state.invalid ? { data: { user: null }, error: { status: 400 } } : { data: { user: { id: 'user-1', email: input.email } }, error: null }; },
      signUp: async input => { state.calls.push(['signup', input]); return { data: { session: state.autoConfirm ? {} : null, user: { id: 'user-1', email: input.email } }, error: null }; },
      resetPasswordForEmail: async (email, options) => { state.calls.push(['recover', email, options]); return { error: null }; },
      getClaims: async () => ({ data: { claims: state.authenticated ? { sub: 'user-1' } : null }, error: null }),
      updateUser: async input => { state.calls.push(['update', input]); return { error: null }; }
    },
    from: () => ({ upsert: async input => { state.profile = input; return {}; } })
  };
  const env = { hasSupabaseEnv: () => true, getConfiguredSiteUrls: () => ['https://app.example.test'], getSiteUrl: () => 'https://app.example.test' };
  const url = compile('lib/url.ts', { '@/lib/env': env });
  const route = compile('app/api/auth/password/route.ts', { '@/lib/env': env, '@/lib/url': url, '@/lib/supabase/server': { createClient: async () => supabase } });
  const request = (body, origin = 'https://app.example.test') => new Request('https://app.example.test/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json', host: 'app.example.test', origin }, body: JSON.stringify(body) });
  try {
    reset(); assert.equal((await route.POST(request({ action: 'login', email: 'a@example.test', password: 'abc' }, 'https://evil.test'))).status, 403); assert.equal(state.calls.length, 0);
    reset(); assert.equal((await route.POST(request({ action: 'signup', email: 'not-email', password: 'longpassword' }))).status, 400);
    assert.equal((await route.POST(request({ action: 'signup', email: 'a@example.test', password: 'short' }))).status, 400); assert.equal(state.calls.length, 0);
    reset(); state.invalid = true; assert.equal((await route.POST(request({ action: 'login', email: 'a@example.test', password: 'wrong' }))).status, 401);
    reset(); let response = await route.POST(request({ action: 'login', email: 'a@example.test', password: 'ok', next: '//evil.test' }));
    assert.equal(response.status, 200); assert.equal((await response.json()).redirectTo, '/login?next=%2Fdashboard%2Fchat'); assert.equal(state.profile.id, 'user-1');
    reset(); response = await route.POST(request({ action: 'signup', email: 'a@example.test', password: 'password123', next: '/dashboard/graph' }));
    assert.equal(response.status, 200); assert.match((await response.json()).message, /confirmation/); const confirm = new URL(state.calls[0][1].options.emailRedirectTo); assert.equal(confirm.pathname, '/auth/callback'); assert.equal(confirm.searchParams.get('flow'), 'email_signup'); assert.equal(confirm.searchParams.get('next'), '/dashboard/graph');
    reset(); state.autoConfirm = true; response = await route.POST(request({ action: 'signup', email: 'a@example.test', password: 'password123' })); assert.match((await response.json()).redirectTo, /^\/login\?/); assert.equal(state.profile.id, 'user-1');
    reset(); response = await route.POST(request({ action: 'recover', email: 'a@example.test', next: '/dashboard/chat' })); assert.match((await response.json()).message, /If an account exists/); const recovery = new URL(state.calls[0][2].redirectTo); assert.equal(recovery.searchParams.get('flow'), 'recovery');
    reset(); state.authenticated = false; assert.equal((await route.POST(request({ action: 'update', password: 'password123' }))).status, 401); assert.equal(state.calls.length, 0);
    reset(); response = await route.POST(request({ action: 'update', password: 'newpassword', next: '/dashboard/chat' })); assert.equal(response.status, 200); assert.equal(state.calls[0][0], 'update');
  } finally { reset(); }
});

test('email confirmation and recovery callbacks never restart Google OAuth', async () => {
  const env = { hasSupabaseEnv: () => true, getConfiguredSiteUrls: () => ['https://app.example.test'], getSiteUrl: () => 'https://app.example.test' };
  const url = compile('lib/url.ts', { '@/lib/env': env });
  let exchange = 0, writes = 0;
  const supabase = { auth: { exchangeCodeForSession: async () => { exchange++; return { error: null }; }, getClaims: async () => ({ data: { claims: { sub: 'user-1', email: 'a@example.test' } } }) }, from: () => ({ upsert: async () => { writes++; }, select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: {} }) }) }) }) };
  const route = compile('app/auth/callback/route.ts', { '@/lib/env': env, '@/lib/url': url, '@/lib/onboarding': { getUserIdFromClaims: c => c?.sub, isOnboardingComplete: () => true, onboardingPath: x => x, onboardingProfileSelect: 'id' }, '@/lib/supabase/server': { createClient: async () => supabase } });
  let response = await route.GET(new Request('https://app.example.test/auth/callback?code=123&flow=recovery'));
  assert.equal(new URL(response.headers.get('location')).pathname, '/login'); assert.match(decodeURIComponent(response.headers.get('location')), /same.browser/i); assert.equal(exchange, 0);
  const headers = { cookie: 'sb-example-auth-token-code-verifier=secret' };
  response = await route.GET(new Request('https://app.example.test/auth/callback?code=123&flow=recovery&next=%2Fdashboard%2Fchat', { headers }));
  assert.equal(new URL(response.headers.get('location')).pathname, '/auth/update-password'); assert.equal(writes, 0);
  response = await route.GET(new Request('https://app.example.test/auth/callback?code=123&flow=email_signup&next=%2Fdashboard%2Fchat', { headers }));
  assert.equal(new URL(response.headers.get('location')).pathname, '/dashboard/chat'); assert.equal(writes, 1);
});
