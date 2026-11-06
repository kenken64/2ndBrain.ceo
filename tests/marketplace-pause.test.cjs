const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function compile(file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', file);
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = module.paths;
  const original = Module._load;
  try {
    Module._load = function (request, ...args) { return Object.hasOwn(mocks, request) ? mocks[request] : original.call(this, request, ...args); };
    instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText, filename);
  } finally { Module._load = original; }
  return instance.exports;
}

const next = { NextResponse: { json: (body, options = {}) => Response.json(body, options) } };
const allocations = compile('lib/workflow-tool-allocations.ts');
const catalog = compile('lib/workflow-templates.ts', { '@/lib/workflow-tool-allocations': allocations });
const launchConfig = compile('lib/workflow-launch.ts', { 'server-only': {} });
function mocksFor(admin, isAdmin = false) {
  return {
    'server-only': {}, 'next/server': next,
    '@/lib/admin': { isAdminUser: async () => isAdmin },
    '@/lib/env': { hasSupabaseEnv: () => true },
    '@/lib/onboarding': { getUserIdFromClaims: claims => claims?.sub },
    '@/lib/supabase/admin': { createAdminClient: () => admin, hasSupabaseServiceRoleEnv: () => true },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: 'user-1', email: 'person@example.test' } } }) } }) },
    '@/lib/token-quota-redis': { publishTokenQuotaUpdate: async () => { throw Error('Unexpected credit event'); } },
    '@/lib/workflow-templates': catalog, '@/lib/workflow-tool-allocations': allocations,
    '@/lib/workflow-launch': launchConfig
  };
}
function queryResult(data, error = null) {
  return { select() { return this; }, eq() { return this; }, neq() { return this; }, in() { return this; }, lte() { return this; }, order() { return this; }, limit() { return this; },
    async maybeSingle() { return { data, error }; },
    then(resolve, reject) { return Promise.resolve({ data, error }).then(resolve, reject); }
  };
}

test('paused install API rejects paid, free and admin purchases before any credit mutation', async () => {
  let rpcCalls = 0;
  const admin = {
    from: () => queryResult({ email: 'person@example.test', openclaw_tokens_paused: true }),
    rpc() { rpcCalls++; throw Error('Unexpected purchase'); }
  };
  for (const isAdmin of [false, true]) {
    const route = compile('app/api/marketplace/install/route.ts', mocksFor(admin, isAdmin));
    for (const itemId of ['2d-game-dev-tutorial', 'two-wheel-robot-guide', 'pomodoro-timer']) {
      const response = await route.POST({ json: async () => ({ itemId }) });
      assert.equal(response.status, 423);
      assert.equal((await response.json()).code, 'ai_usage_paused');
    }
  }
  assert.equal(rpcCalls, 0);
});

test('a pause detected by the purchase transaction returns 423 to a stale browser', async () => {
  let called = false;
  const admin = {
    from: () => queryResult({ email: 'person@example.test', openclaw_tokens_paused: false }),
    rpc() { called = true; return { single: async () => ({ data: null, error: { message: 'ai_usage_paused' } }) }; }
  };
  const route = compile('app/api/marketplace/install/route.ts', mocksFor(admin));
  const response = await route.POST({ json: async () => ({ itemId: '2d-game-dev-tutorial' }) });
  assert.equal(called, true);
  assert.equal(response.status, 423);
  assert.equal((await response.json()).code, 'ai_usage_paused');
});

test('already-open signed tool sessions become inactive while paused and active after resume', async () => {
  let paused = false;
  const admin = { from: table => queryResult(table === 'profiles'
    ? { admin_disabled: false, marketplace_launch_revoked_at: null, openclaw_tokens_paused: paused }
    : { id: 'install-1', item_id: '2d-game-dev-tutorial', status: 'installed' }) };
  const mocks = mocksFor(admin);
  const access = compile('lib/marketplace-session-access.ts', mocks);
  const route = compile('app/api/marketplace/launch-session/verify/route.ts', { ...mocks, '@/lib/marketplace-session-access': access });
  const previous = process.env.MARKETPLACE_LAUNCH_VERIFY_SECRET;
  try {
    process.env.MARKETPLACE_LAUNCH_VERIFY_SECRET = 'test-verifier-secret-'.repeat(3);
    const request = () => new Request('https://app.test/api/marketplace/launch-session/verify', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.MARKETPLACE_LAUNCH_VERIFY_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1', installId: 'install-1', toolId: '2d-game-dev-tutorial', issuedAt: Math.floor(Date.now() / 1000) })
    });
    assert.equal((await route.POST(request())).status, 200);
    paused = true;
    const denied = await route.POST(request());
    assert.equal(denied.status, 423);
    assert.equal((await denied.json()).active, false);
    assert.equal(denied.headers.get('Cache-Control'), 'no-store');
    paused = false;
    assert.equal((await route.POST(request())).status, 200);
  } finally {
    if (previous === undefined) delete process.env.MARKETPLACE_LAUNCH_VERIFY_SECRET;
    else process.env.MARKETPLACE_LAUNCH_VERIFY_SECRET = previous;
  }
});

test('Gyne bridge checks pause using the forwarded owner even without a browser session', async () => {
  let profile = { openclaw_tokens_paused: true };
  let error = null;
  const admin = { from: () => queryResult(profile, error) };
  const { authorizeGyneBridge } = compile('lib/gyne-bridge.ts', mocksFor(admin));
  const previous = process.env.GYNE_BRAIN_API_SECRET;
  try {
    process.env.GYNE_BRAIN_API_SECRET = 'fixture-bridge-secret';
    const request = () => new Request('https://app.test/api/gyne/projects?user_id=user-1', { headers: { Authorization: 'Bearer fixture-bridge-secret' } });
    const denied = await authorizeGyneBridge(request());
    assert.equal(denied.ok, false);
    assert.equal(denied.response.status, 423);
    profile.openclaw_tokens_paused = false;
    assert.equal((await authorizeGyneBridge(request())).ok, true);
    error = { message: 'database unavailable' };
    assert.equal((await authorizeGyneBridge(request())).response.status, 503);
    error = null; profile = null;
    assert.equal((await authorizeGyneBridge(request())).response.status, 404);
  } finally {
    if (previous === undefined) delete process.env.GYNE_BRAIN_API_SECRET;
    else process.env.GYNE_BRAIN_API_SECRET = previous;
  }
});

test('paused users can browse installs without read-triggered renewals', async () => {
  const profile = { email: 'person@example.test', openclaw_tokens_paused: true, llm_token_quota: 100000, llm_token_used: 0 };
  const install = { id: 'install-1', item_id: '2d-game-dev-tutorial', status: 'installed', charged_tokens: 10000, price_tokens: 10000 };
  const admin = {
    from: table => queryResult(table === 'profiles' ? profile : table === 'marketplace_installs' ? [install] : []),
    rpc() { throw Error('A paused browse must not run renewal sync'); }
  };
  const route = compile('app/api/marketplace/installs/route.ts', mocksFor(admin));
  const response = await route.GET();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.aiUsagePaused, true);
  assert.equal(payload.balance.availableTokens, 100000);
  assert.equal(payload.installs[0].itemId, install.item_id);
});

test('scheduled renewals skip paused accounts while processing active accounts', async () => {
  const calls = [];
  const admin = {
    from: table => queryResult(table === 'marketplace_installs' ? [{ user_id: 'paused-user' }, { user_id: 'active-user' }] : [
      { id: 'paused-user', openclaw_tokens_paused: true }, { id: 'active-user', openclaw_tokens_paused: false }
    ]),
    async rpc(name, input) {
      if (name === 'due_marketplace_tool_subscription_users') return { data: [{ user_id: 'paused-user' }, { user_id: 'active-user' }], error: null };
      calls.push(input.p_user_id); return { data: [], error: null };
    }
  };
  const route = compile('app/api/marketplace/renewals/route.ts', mocksFor(admin));
  const previous = process.env.MARKETPLACE_RENEWAL_SECRET;
  try {
    process.env.MARKETPLACE_RENEWAL_SECRET = 'fixture-renewal-secret';
    const response = await route.POST(new Request('https://app.test/api/marketplace/renewals', { method: 'POST', headers: { Authorization: 'Bearer fixture-renewal-secret' } }));
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ['active-user']);
    assert.equal((await response.json()).chargedTokens, 0);
  } finally {
    if (previous === undefined) delete process.env.MARKETPLACE_RENEWAL_SECRET;
    else process.env.MARKETPLACE_RENEWAL_SECRET = previous;
  }
});

test('pause display refreshes on focus and polling, and preserves state on failed refreshes', async () => {
  const previousWindow = global.window, previousDocument = global.document, previousFetch = global.fetch;
  const effects = [], listeners = new Map();
  let paused = false, serverPaused = true, fail = false, poll, cleared = false;
  global.window = { setInterval: fn => { poll = fn; return 1; }, clearInterval: () => { cleared = true; }, addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) };
  global.document = { visibilityState: 'visible', addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) };
  global.fetch = async () => fail ? new Response(null, { status: 503 }) : Response.json({ pause: { openclawTokensPaused: serverPaused } });
  const { useAiUsagePause } = compile('components/use-ai-usage-pause.ts', { react: { useState: initial => { paused = initial; return [initial, value => { paused = value; }]; }, useEffect: fn => effects.push(fn) } });
  let cleanup;
  try {
    useAiUsagePause(false);
    cleanup = effects[0]();
    await new Promise(setImmediate);
    assert.equal(paused, true);
    serverPaused = false;
    await listeners.get('focus')();
    assert.equal(paused, false);
    serverPaused = true;
    await poll();
    assert.equal(paused, true);
    fail = true;
    await poll();
    assert.equal(paused, true);
    cleanup(); cleanup = null;
    assert.equal(listeners.size, 0);
    assert.equal(cleared, true);
  } finally {
    if (cleanup) cleanup();
    global.window = previousWindow; global.document = previousDocument; global.fetch = previousFetch;
  }
});
