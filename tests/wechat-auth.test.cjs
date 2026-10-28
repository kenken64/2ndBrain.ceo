const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function compile(file, replacements) {
  const filename = path.resolve(__dirname, '..', file);
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = module.paths;
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const load = Module._load;
  try {
    Module._load = function (name) { return Object.hasOwn(replacements, name) ? replacements[name] : load.apply(this, arguments); };
    instance._compile(output, filename);
  } finally { Module._load = load; }
  return instance.exports;
}

test('WeChat OAuth starts only when enabled and preserves provider across redirects', async () => {
  let enabled = false, invocation, origin = 'https://app.example.test';
  const env = { hasSupabaseEnv: () => true, isWechatLoginEnabled: () => enabled, getConfiguredSiteUrls: () => [origin], getSiteUrl: () => origin };
  const url = compile('lib/url.ts', { '@/lib/env': env });
  const route = compile('app/auth/login/route.ts', {
    '@/lib/env': env, '@/lib/url': url,
    '@/lib/supabase/server': { createClient: async () => ({ auth: { signInWithOAuth: async (input) => { invocation = input; return { data: { url: 'https://identity.example.test/authorize' }, error: null }; } } }) }
  });
  const request = value => new Request(value);
  let response = await route.GET(request('https://app.example.test/auth/login?provider=wechat'));
  assert.match(response.headers.get('location'), /wechat_unavailable/);
  assert.equal(invocation, undefined);
  enabled = true;
  response = await route.GET(request('https://app.example.test/auth/login?provider=wechat&next=%2Fdashboard%2Fgraph'));
  assert.equal(response.headers.get('location'), 'https://identity.example.test/authorize');
  assert.equal(invocation.provider, 'custom:wechat');
  assert.equal(invocation.options.queryParams, undefined);
  const callback = new URL(invocation.options.redirectTo);
  assert.equal(callback.searchParams.get('next'), '/dashboard/graph');
  assert.equal(callback.searchParams.get('provider'), 'wechat');
  await route.GET(request('https://app.example.test/auth/login?provider=wechat&next=%2F%5Cevil.example'));
  assert.equal(new URL(invocation.options.redirectTo).searchParams.get('next'), '/dashboard/chat');
  response = await route.GET(request('https://other.example.test/auth/login?provider=wechat&next=%2Fdashboard%2Fchat&pkce_retry=1'));
  const canonical = new URL(response.headers.get('location'));
  assert.equal(canonical.origin, origin);
  assert.equal(canonical.searchParams.get('provider'), 'wechat');
  assert.equal(canonical.searchParams.get('pkce_retry'), '1');
  response = await route.GET(request('https://app.example.test/auth/login?provider=unknown'));
  assert.match(response.headers.get('location'), /unsupported_provider/);
  await route.GET(request('https://app.example.test/auth/login'));
  assert.equal(invocation.provider, 'google');
  assert.equal(invocation.options.queryParams.prompt, 'select_account consent');
});

test('WeChat callback retry preserves provider and does not erase an existing profile email', async () => {
  const env = { hasSupabaseEnv: () => true, getConfiguredSiteUrls: () => ['https://app.example.test'], getSiteUrl: () => 'https://app.example.test' };
  const url = compile('lib/url.ts', { '@/lib/env': env });
  let written;
  const supabase = {
    auth: { exchangeCodeForSession: async () => ({ error: null }), getClaims: async () => ({ data: { claims: { sub: 'user-1' } } }) },
    from: () => ({ upsert: async value => { written = value; }, select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: {} }) }) }) })
  };
  const route = compile('app/auth/callback/route.ts', {
    '@/lib/env': env, '@/lib/url': url,
    '@/lib/onboarding': { getUserIdFromClaims: c => c?.sub, isOnboardingComplete: () => true, onboardingPath: x => x, onboardingProfileSelect: 'id' },
    '@/lib/supabase/server': { createClient: async () => supabase }
  });
  let response = await route.GET(new Request('https://app.example.test/auth/callback?code=123&provider=wechat&next=%2Fdashboard%2Fchat'));
  const retry = new URL(response.headers.get('location'));
  assert.equal(retry.pathname, '/auth/login');
  assert.equal(retry.searchParams.get('provider'), 'wechat');
  assert.equal(retry.searchParams.get('pkce_retry'), '1');
  response = await route.GET(new Request('https://app.example.test/auth/callback?code=123&provider=wechat', { headers: { cookie: 'sb-example-auth-token-code-verifier=test' } }));
  assert.deepEqual(written, { id: 'user-1' });
  assert.equal(new URL(response.headers.get('location')).pathname, '/dashboard/chat');
});
