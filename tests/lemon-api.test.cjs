const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const ts = require('typescript');
function compile(file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', file); const instance = new Module(filename, module); instance.filename = filename; instance.paths = module.paths;
  const original = Module._load;
  try { Module._load = function(request, ...args) { return Object.hasOwn(mocks, request) ? mocks[request] : original.call(this, request, ...args); };
    instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  } finally { Module._load = original; }
  return instance.exports;
}
const pricing = compile('lib/credit-pricing.ts');
const lemon = compile('lib/lemon-squeezy.ts', { 'server-only': {}, '@/lib/credit-pricing': pricing });
const config = { apiKey: 'api-test', storeId: '1', variantIds: Object.fromEntries(pricing.SGD_TOPUP_CENTS.map((cents, index) => [cents, String(index + 2)])), webhookSecret: 'webhook-test-secret', testMode: false, allowTestCredits: false };
const intent = '00000000-0000-4000-8000-000000000001';

test('six SGD variants verify their fixed prices, mode, store and safe hosted URL', async () => {
  const original = global.fetch; let captured; let issue = ''; let selectedCents = 500, selectedId = '2';
  global.fetch = async (url, options) => {
    const value = String(url);
    if (value.endsWith('/stores/1')) return Response.json({ data: { id: '1', attributes: { currency: issue === 'currency' ? 'USD' : 'SGD', domain: 'store.lemonsqueezy.com' } } });
    if (value.endsWith(`/variants/${selectedId}`)) return Response.json({ data: { id: selectedId, attributes: { product_id: 3, test_mode: issue === 'mode', status: 'published' } } });
    if (value.includes('/prices?')) return Response.json({ data: [{ attributes: { variant_id: Number(selectedId), category: issue === 'subscription' ? 'subscription' : 'one_time', scheme: 'standard', unit_price: issue === 'price' ? selectedCents - 1 : selectedCents } }] });
    if (value.endsWith('/products/3')) return Response.json({ data: { attributes: { store_id: issue === 'store' ? 9 : 1, status: 'published', test_mode: false, pay_what_you_want: false } } });
    if (value.endsWith('/checkouts')) { captured = JSON.parse(options.body); return Response.json({ data: { attributes: { store_id: 1, variant_id: Number(selectedId), test_mode: false, custom_price: issue === 'custom_price' ? 1 : null, url: issue === 'url' ? 'https://attacker.example/checkout/custom/1' : 'https://store.lemonsqueezy.com/checkout/custom/1' } } }); }
    throw Error('unexpected fetch');
  };
  try {
    for (selectedCents of pricing.SGD_TOPUP_CENTS) {
      selectedId = config.variantIds[selectedCents];
      const result = await lemon.createLemonCheckout(config, intent, selectedCents);
      assert.match(result.url, /^https:\/\/store\.lemonsqueezy\.com\//);
      assert.equal(captured.data.relationships.variant.data.id, selectedId);
      assert.deepEqual(captured.data.attributes.product_options.enabled_variants, [Number(selectedId)]);
      assert.equal(captured.data.attributes.custom_price, undefined);
    }
    assert.equal(captured.data.attributes.checkout_data.custom.intent_id, intent);
    assert.equal(captured.data.attributes.checkout_data.custom.proof, lemon.lemonIntentProof(intent, config.webhookSecret));
    assert.deepEqual(captured.data.attributes.checkout_data.variant_quantities, [{ variant_id: Number(selectedId), quantity: 1 }]);
    assert.equal(captured.data.attributes.checkout_options.embed, true);
    for (issue of ['currency', 'subscription', 'price', 'store', 'url', 'custom_price', 'mode']) await assert.rejects(lemon.createLemonCheckout(config, intent, selectedCents), /lemon_(product_mismatch|checkout_invalid)/, issue);
  } finally { global.fetch = original; }
});

test('webhook validates the raw signature, custom intent and test mode', async () => {
  const previous = Object.fromEntries(['LEMONSQUEEZY_WEBHOOK_SECRET','LEMONSQUEEZY_ALLOW_TEST_CREDITS'].map(key => [key, process.env[key]]));
  process.env.LEMONSQUEEZY_WEBHOOK_SECRET = config.webhookSecret; delete process.env.LEMONSQUEEZY_ALLOW_TEST_CREDITS;
  let calls = [], notifications = [];
  const admin = {
    rpc: (name, params) => ({ single: async () => { calls.push({ name, params }); return { data: { user_id: 'user', llm_token_quota: 7500000, llm_token_used: 0, delta_tokens: 7500000 }, error: null }; } }),
    from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { email: 'user@example.test', openclaw_instance: null } }; } })
  };
  const route = compile('app/api/billing/lemon/webhook/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/env': { hasSupabaseEnv: () => true }, '@/lib/lemon-squeezy': lemon,
    '@/lib/supabase/admin': { createAdminClient: () => admin, hasSupabaseServiceRoleEnv: () => true },
    '@/lib/token-quota-redis': { publishTokenQuotaUpdate: async item => notifications.push(item) }
  });
  function payload(testMode = false) { return { meta: { event_name: 'order_created', custom_data: { intent_id: intent, proof: lemon.lemonIntentProof(intent, config.webhookSecret) } }, data: { type: 'orders', id: '123', attributes: { store_id: 1, first_order_item: { variant_id: 2 }, status: 'paid', test_mode: testMode, currency: 'SGD', subtotal: 500, discount_total: 0, total: 550, subtotal_usd: 390, discount_total_usd: 0, total_usd: 429 } } }; }
  function request(value, signature) { const raw = JSON.stringify(value); return new Request('http://localhost/api/billing/lemon/webhook', { method: 'POST', headers: { 'x-signature': signature ?? crypto.createHmac('sha256', config.webhookSecret).update(raw).digest('hex') }, body: raw }); }
  try {
    assert.equal((await route.POST(request(payload(), 'bad'))).status, 401); assert.equal(calls.length, 0);
    let bad = payload(); bad.meta.custom_data.proof = '0'.repeat(64);
    assert.equal((await route.POST(request(bad))).status, 400); assert.equal(calls.length, 0);
    assert.equal((await route.POST(request(payload(true)))).status, 200); assert.equal(calls.length, 0);
    assert.equal((await route.POST(request(payload()))).status, 200); assert.equal(calls.length, 1);
    assert.equal(calls[0].params.p_intent_id, intent); assert.equal(calls[0].params.p_total_usd, 429); assert.equal(calls[0].name, 'apply_lemon_credit_order_v2'); assert.equal(calls[0].params.p_currency, 'SGD'); assert.equal(calls[0].params.p_subtotal, 500); assert.equal(calls[0].params.p_refunded_usd, 0);
    assert.equal(notifications[0].reason, 'lemon_credit_purchase');
    const partial = payload(); partial.meta.event_name = 'order_refunded'; partial.data.attributes.status = 'partial_refund'; partial.data.attributes.refunded_amount_usd = 214; partial.data.attributes.refunded_amount = 275;
    assert.equal((await route.POST(request(partial))).status, 200); assert.equal(calls[1].params.p_refunded_usd, 214); assert.equal(calls[1].params.p_refunded, 275);
    partial.data.attributes.refunded_amount = 0;
    assert.equal((await route.POST(request(partial))).status, 400);
  } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test('checkout requires authentication and a same-origin request and stores a user-bound intent', async () => {
  let user = 'user-1', insertion = null;
  const admin = { from: table => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { assert.equal(table, 'profiles'); return { data: { admin_disabled: false, admin_deleted_at: null } }; }, async insert(row) { assert.equal(table, 'lemon_credit_checkouts'); insertion = row; return { error: null }; } }) };
  const route = compile('app/api/billing/lemon/checkout/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/env': { hasSupabaseEnv: () => true },
    '@/lib/credit-pricing': pricing,
    '@/lib/credit-pricing-server': { resolveCreditOption: async (sgd, usd) => { if (sgd == null && usd == null) return { usdCents: 3000, credits: 7500000 }; if (sgd === 500 && usd === 391) return { usdCents: 391, credits: 977500 }; throw Error('credit_price_changed'); } },
    '@/lib/lemon-squeezy': { lemonConfig: () => config, createLemonCheckout: async (_config, intentId) => ({ url: `https://store.lemonsqueezy.com/checkout/custom/${intentId}` }) },
    '@/lib/onboarding': { getUserIdFromClaims: claims => claims?.sub },
    '@/lib/solana-billing': { AI_CREDIT_PACKAGE_TOKENS: 7500000, AI_CREDIT_PACKAGE_USD_CENTS: 3000 },
    '@/lib/supabase/admin': { createAdminClient: () => admin, hasSupabaseServiceRoleEnv: () => true },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: user ? { sub: user } : null }, error: null }) } }) }
  });
  const request = (origin = 'https://example.test', body = { sgdCents: 500, expectedUsdCents: 391 }) => new Request('https://example.test/api/billing/lemon/checkout', { method: 'POST', headers: { host: 'example.test', origin }, body: JSON.stringify(body) });
  assert.equal((await route.POST(request('https://attacker.test'))).status, 403); assert.equal(insertion, null);
  user = null; assert.equal((await route.POST(request())).status, 401); assert.equal(insertion, null);
  user = 'user-1'; const response = await route.POST(request());
  assert.equal(response.status, 200); assert.equal(insertion.user_id, 'user-1'); assert.equal(insertion.package_tokens, 977500); assert.equal(insertion.usd_amount_cents, 391); assert.equal(insertion.variant_id, '2'); assert.equal(insertion.currency, 'SGD'); assert.equal(insertion.amount_cents, 500);
  assert.equal((await route.POST(request('https://example.test', {}))).status, 400);
  assert.equal(response.body.intentId, insertion.id); assert.match(response.body.url, /^https:\/\/store\.lemonsqueezy\.com\/checkout\//);
  const selected = new Request('https://example.test/api/billing/lemon/checkout', { method: 'POST', headers: { host: 'example.test', origin: 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify({ sgdCents: 500, expectedUsdCents: 391 }) });
  assert.equal((await route.POST(selected)).status, 200); assert.equal(insertion.usd_amount_cents, 391); assert.equal(insertion.package_tokens, 977500);
  const stale = new Request('https://example.test/api/billing/lemon/checkout', { method: 'POST', headers: { host: 'example.test', origin: 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify({ sgdCents: 500, expectedUsdCents: 1 }) });
  assert.equal((await route.POST(stale)).status, 409);
});

test('status lookup is scoped to the signed-in user', async () => {
  let queryUser;
  const admin = { from: table => ({ select() { return this; }, eq(key, value) { if (key === 'user_id') queryUser = value; return this; }, async maybeSingle() {
    if (table === 'profiles') return { data: { llm_token_quota: 7500000, llm_token_used: 0, admin_disabled: false, admin_deleted_at: null }, error: null };
    return { data: queryUser === 'owner' ? { status: 'paid', credited_tokens: 7500000 } : null, error: null };
  } }) };
  let user = 'owner';
  const route = compile('app/api/billing/lemon/status/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/env': { hasSupabaseEnv: () => true }, '@/lib/onboarding': { getUserIdFromClaims: claims => claims?.sub },
    '@/lib/supabase/admin': { createAdminClient: () => admin, hasSupabaseServiceRoleEnv: () => true },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: user } }, error: null }) } }) }
  });
  const request = () => new Request(`https://example.test/api/billing/lemon/status?intent=${intent}`);
  assert.equal((await route.GET(request())).status, 200); assert.equal(queryUser, 'owner');
  user = 'other'; assert.equal((await route.GET(request())).status, 404); assert.equal(queryUser, 'other');
});

test('payment settings offer the card package only when configured', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const language = { Localized: ({ en }) => en, LocalizedMessage: ({ text }) => text };
  const { LemonCreditPurchase } = compile('components/lemon-credit-purchase.tsx', { '@/components/language-provider': language });
  const props = { configured: true, testMode: false, selection: { sgdCents: 500, usdCents: 391, credits: 977500, cnyCents: 2611 }, packageTokens: 977500, packageUsdCents: 391, onBalanceChange() {} };
  const ready = renderToStaticMarkup(React.createElement(LemonCreditPurchase, props));
  assert.match(ready, /977,500 AI credits for S\$5\.00/);
  assert.match(ready, /Continue to secure checkout/);
  assert.doesNotMatch(ready, /disabled=""/);
  const unavailable = renderToStaticMarkup(React.createElement(LemonCreditPurchase, { ...props, configured: false }));
  assert.match(unavailable, /Card payment is not available yet/);
  assert.match(unavailable, /disabled=""/);
});


test('configuration requires six distinct numeric SGD variant IDs', () => {
  const keys = ['LEMONSQUEEZY_API_KEY', 'LEMONSQUEEZY_STORE_ID', 'LEMONSQUEEZY_WEBHOOK_SECRET', 'LEMONSQUEEZY_TEST_MODE', ...pricing.SGD_TOPUP_CENTS.map(cents => `LEMONSQUEEZY_VARIANT_ID_SGD_${cents / 100}`)];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, { LEMONSQUEEZY_API_KEY: 'test', LEMONSQUEEZY_STORE_ID: '1', LEMONSQUEEZY_WEBHOOK_SECRET: 'secret', LEMONSQUEEZY_TEST_MODE: 'true' });
    for (const cents of pricing.SGD_TOPUP_CENTS) process.env[`LEMONSQUEEZY_VARIANT_ID_SGD_${cents / 100}`] = config.variantIds[cents];
    assert.deepEqual(lemon.lemonConfig().variantIds, config.variantIds);
    delete process.env.LEMONSQUEEZY_VARIANT_ID_SGD_15;
    assert.equal(lemon.lemonConfig(), null);
    process.env.LEMONSQUEEZY_VARIANT_ID_SGD_15 = config.variantIds[500];
    assert.equal(lemon.lemonConfig(), null);
  } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
