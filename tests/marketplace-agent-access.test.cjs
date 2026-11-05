const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { PGlite } = require('@electric-sql/pglite');

function compile(file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', file);
  const instance = new Module(filename, module); instance.filename = filename; instance.paths = module.paths;
  const original = Module._load;
  try {
    Module._load = function (request, ...args) { return Object.hasOwn(mocks, request) ? mocks[request] : original.call(this, request, ...args); };
    instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  } finally { Module._load = original; }
  return instance.exports;
}
const allocation = compile('lib/workflow-tool-allocations.ts');
const catalog = compile('lib/workflow-templates.ts', { '@/lib/workflow-tool-allocations': allocation });
const messages = compile('lib/ui-messages.ts');
const lang = { useLanguage: () => ({ language: 'en' }), Localized: ({ en }) => en, LocalizedMessage: ({ text }) => text };
function renderMarketplace(credits) {
  const states = [{ isAdmin: false, balance: { availableTokens: credits }, installs: [] }, null, null, false, null, 1, 12, '2D Game Development'];
  const react = { ...React, useState: () => [states.shift(), () => {}], useEffect: () => {}, useMemo: fn => fn() };
  const { WorkflowMarketplace } = compile('components/workflow-marketplace.tsx', { react, '@/components/language-provider': lang, '@/lib/workflow-templates': catalog, '@/lib/ui-messages': messages });
  return renderToStaticMarkup(React.createElement(WorkflowMarketplace, { setupComplete: true, agentAvailable: false }));
}
function renderWorkflow(credits, status = 'installed', canUsePaidTools = false) {
  const install = { itemId: '2d-game-dev-tutorial', status, chargedTokens: 10000, priceTokens: 10000, allocation: { allocatedTokens: 10000, usedTokens: 10000 - credits, availableTokens: credits, quotaExempt: false } };
  const states = [[install], null, null, false, canUsePaidTools, null, null];
  const react = { ...React, useState: () => [states.shift(), () => {}], useEffect: () => {}, useMemo: fn => fn() };
  const { MyWorkflows } = compile('components/my-workflows.tsx', { react, '@/components/language-provider': lang, '@/lib/workflow-templates': catalog });
  return renderToStaticMarkup(React.createElement(MyWorkflows, { setupComplete: true, agentAvailable: false }));
}

test('catalog identifies independent apps and agent-dependent tasks', () => {
  for (const id of ['two-wheel-robot-guide', 'pomodoro-timer', '2d-game-dev-tutorial', 'psle-eng-tutor-brain', 'meeting-minutes', 'mobile-device-operator']) assert.equal(catalog.marketplaceItemById(id).requiresCloudAgent, false, id);
  for (const id of ['gyne-agent', 'news-intelligence-desk']) assert.equal(catalog.marketplaceItemById(id).requiresCloudAgent, true, id);
});

test('a chat-only user can install a standalone paid app with sufficient credits', () => {
  const enough = renderMarketplace(10000);
  assert.match(enough, /No personal cloud agent required/);
  assert.match(enough, /<button class="btn-primary" type="button">/);
  assert.match(renderMarketplace(9999), /<button class="btn-primary" disabled="" type="button">/);
});

test('an active paid tool can launch with its own allocation and no general credits', () => {
  const available = renderWorkflow(10000);
  assert.match(available, /No personal cloud agent required/);
  assert.match(available, /<button class="btn-primary" type="button">/);
  assert.match(renderWorkflow(0), /<button class="btn-primary" disabled="" type="button">/);
  assert.match(renderWorkflow(10000, 'disabled'), /<button class="btn-primary" disabled="" type="button">/);
});

test('paid installs enforce credit balance without an agent', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
      create table public.profiles (id uuid primary key, admin_disabled boolean default false, admin_deleted_at timestamptz, llm_token_quota bigint not null default 0, llm_token_used bigint not null default 0, openclaw_instance text);
      create table public.credit_ledger (id uuid primary key default gen_random_uuid(), user_id uuid, delta_tokens bigint, balance_after bigint, reason text, metadata jsonb);`);
    for (const file of ['0019_marketplace_tool_allocations.sql', '0020_marketplace_tool_unsubscribe.sql']) await db.exec(fs.readFileSync(path.resolve(__dirname, '../supabase/migrations', file), 'utf8'));
    const user = '00000000-0000-0000-0000-000000000001';
    await db.query('insert into auth.users values ($1)', [user]);
    await db.query('insert into profiles (id,llm_token_quota) values ($1,9999)', [user]);
    const purchase = () => db.query("select * from public.install_marketplace_tool($1,'2d-game-dev-tutorial','agent-app','2D Game Development Tutorial',10000,null,false,'{}'::jsonb)", [user]);
    await assert.rejects(purchase(), /insufficient_ai_credits/);
    assert.equal(Number((await db.query('select count(*) as count from marketplace_installs')).rows[0].count), 0);
    await db.query('update profiles set llm_token_quota=10000 where id=$1', [user]);
    const result = (await purchase()).rows[0];
    assert.equal(result.status, 'installed');
    assert.equal(Number(result.available_tokens), 0);
    assert.equal(Number(result.allocated_tokens), 10000);
  } finally { await db.close(); }
});

test('standalone paid app launch works with no cloud agent or general balance', async () => {
  let status = 'installed';
  const config = compile('lib/workflow-launch.ts', { 'server-only': {} });
  const admin = { from: table => ({ select() { return this; }, eq() { return this; }, neq() { return this; }, async maybeSingle() {
    if (table === 'profiles') return { data: { email: 'user@example.test', admin_disabled: false, admin_deleted_at: null, openclaw_instance: null, llm_token_quota: 0, llm_token_used: 0 }, error: null };
    if (table === 'marketplace_installs') return { data: { id: 'install-1', item_id: '2d-game-dev-tutorial', item_type: 'agent-app', status }, error: null };
    throw Error(`unexpected table ${table}`);
  } }) };
  const route = compile('app/api/marketplace/launch/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/env': { hasSupabaseEnv: () => true }, '@/lib/gyne-consumer-registry': { syncConsumerOwners: async () => {} },
    '@/lib/onboarding': { getUserIdFromClaims: claims => claims?.sub },
    '@/lib/supabase/admin': { createAdminClient: () => admin, hasSupabaseServiceRoleEnv: () => true },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: 'user-1', email: 'user@example.test' } } }) } }) },
    '@/lib/workflow-launch': config, '@/lib/workflow-templates': catalog
  });
  const previousUrl = process.env.GAME_DEV_TUTORIAL_URL, previousSecret = process.env.GAME_DEV_TUTORIAL_SESSION_SECRET;
  try {
    process.env.GAME_DEV_TUTORIAL_URL = 'https://game.example.test/launch';
    process.env.GAME_DEV_TUTORIAL_SESSION_SECRET = 'x'.repeat(40);
    const request = () => ({ json: async () => ({ itemId: '2d-game-dev-tutorial' }) });
    const response = await route.POST(request());
    assert.equal(response.status, 200);
    const signedUrl = new URL(response.body.launchUrl);
    assert.equal(signedUrl.origin, 'https://game.example.test');
    const claims = JSON.parse(Buffer.from(signedUrl.searchParams.get('launch_token').split('.')[1], 'base64url'));
    assert.equal(claims.user_id, 'user-1');
    assert.equal(claims.tool_id, '2d-game-dev-tutorial');
    status = 'disabled';
    assert.equal((await route.POST(request())).status, 423);
  } finally {
    if (previousUrl === undefined) delete process.env.GAME_DEV_TUTORIAL_URL; else process.env.GAME_DEV_TUTORIAL_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.GAME_DEV_TUTORIAL_SESSION_SECRET; else process.env.GAME_DEV_TUTORIAL_SESSION_SECRET = previousSecret;
  }
});
