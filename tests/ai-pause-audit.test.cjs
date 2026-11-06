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
const user = '00000000-0000-0000-0000-000000000001';
const otherUser = '00000000-0000-0000-0000-000000000002';
const language = { useLanguage: () => ({ language: 'en' }), Localized: ({ en }) => en, LocalizedMessage: ({ text }) => text, LanguageToggle: () => null, LocalizedInput: ({ placeholderEn, placeholderZh, ...props }) => React.createElement('input', props) };

test('pause audit retains every transition, imports known timestamps once and restricts history access', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create table profiles (id uuid primary key references auth.users(id) on delete cascade, email text, full_name text,
        openclaw_tokens_paused boolean not null default false, openclaw_tokens_paused_at timestamptz, openclaw_tokens_resumed_at timestamptz,
        openclaw_tokens_pause_reason text, openclaw_tokens_pause_actor_id uuid, openclaw_tokens_pause_actor_email text);`);
    const schema = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/0014_admin_controls.sql'), 'utf8');
    await db.exec(schema.match(/create table if not exists public\.admin_audit_events[\s\S]*?\n\);/)[0]);
    await db.exec('alter table admin_audit_events enable row level security; grant select on admin_audit_events to authenticated;');
    await db.query('insert into auth.users values ($1),($2)', [user, otherUser]);
    await db.query("insert into profiles(id,email,full_name,openclaw_tokens_paused_at,openclaw_tokens_resumed_at) values ($1,'person@example.test','Person','2026-11-05T00:00:00Z','2026-11-05T01:00:00Z')", [user]);
    const migration = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/0048_ai_usage_pause_audit.sql'), 'utf8');
    await db.exec(migration); await db.exec(migration);
    let rows = (await db.query('select * from admin_audit_events order by created_at')).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].action, 'ai_usage_paused');
    assert.equal(rows[0].admin_user_id, null, 'backfill must not invent the historical actor');
    assert.equal(rows[0].details.source, 'existing_timestamp');

    // The actual signed-in identity wins over spoofed profile actor fields.
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [user, JSON.stringify({ email: 'person@example.test' })]);
    await db.query("update profiles set openclaw_tokens_paused=true,openclaw_tokens_paused_at=clock_timestamp(),openclaw_tokens_pause_reason='user_pause',openclaw_tokens_pause_actor_id=$2,openclaw_tokens_pause_actor_email='spoof@example.test' where id=$1", [user, otherUser]);
    rows = (await db.query('select * from admin_audit_events order by created_at')).rows;
    assert.equal(rows.length, 3);
    const paused = rows[2];
    assert.equal(paused.admin_user_id, user);
    assert.equal(paused.admin_email, 'person@example.test');
    assert.equal(paused.target_email, 'person@example.test');
    assert.equal(paused.details.paused, true);
    assert.equal(paused.details.previous_paused, false);
    assert.equal(paused.details.user_name, 'Person');
    await db.query('update profiles set openclaw_tokens_paused=true where id=$1', [user]);
    assert.equal(Number((await db.query('select count(*) as n from admin_audit_events')).rows[0].n), 3, 'idempotent retries do not add events');
    await db.query('update profiles set openclaw_tokens_paused=false,openclaw_tokens_resumed_at=clock_timestamp(),openclaw_tokens_pause_reason=null where id=$1', [user]);
    rows = (await db.query('select * from admin_audit_events order by created_at,id')).rows;
    assert.equal(rows.length, 4);
    assert.equal(rows.filter(row => row.action === 'ai_usage_resumed').length, 2);
    assert.ok(rows.some(row => row.id === paused.id), 'resume preserves the preceding pause');
    await db.exec(migration);
    assert.equal(Number((await db.query('select count(*) as n from admin_audit_events')).rows[0].n), 4, 'rerunning backfill does not duplicate newer transitions');

    await db.exec('set role authenticated');
    assert.equal((await db.query('select * from admin_audit_events')).rows.length, 0, 'ordinary users cannot read pause history');
    await db.exec('reset role');
    await db.query('delete from auth.users where id=$1', [user]);
    rows = (await db.query('select * from admin_audit_events')).rows;
    assert.equal(rows.length, 4, 'deleting an account preserves the audit trail');
    assert.ok(rows.every(row => row.target_user_id === null && row.target_email === 'person@example.test'));
  } finally { await db.close(); }
});

test('pause API requires confirmation and works for chat-only users without altering credit balances', async () => {
  let profile = { id: user, email: 'person@example.test', openclaw_instance: null, openclaw_tokens_paused: false, llm_token_quota: 10000, llm_token_used: 2000 };
  let updates = 0;
  const published = [];
  const admin = { from: () => ({ select() { return this; }, eq() { return this; }, update(value) { updates++; profile = { ...profile, ...value }; return this; }, async maybeSingle() { return { data: profile, error: null }; } }) };
  const route = compile('app/api/settings/token-usage-pause/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/env': { hasSupabaseEnv: () => true }, '@/lib/onboarding': { getUserIdFromClaims: claims => claims?.sub },
    '@/lib/supabase/admin': { createAdminClient: () => admin, hasSupabaseServiceRoleEnv: () => true },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: user, email: profile.email } } }) } }) },
    '@/lib/token-quota-redis': { publishTokenQuotaUpdate: async value => published.push(value) }
  });
  const request = payload => ({ json: async () => payload });
  for (const confirmation of [undefined, '', 'stop']) assert.equal((await route.PATCH(request({ paused: true, confirmation }))).status, 400);
  assert.equal(updates, 0);
  const response = await route.PATCH(request({ paused: true, confirmation: 'pause' }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.pause.openclawTokensPaused, true);
  assert.equal(payload.balance.availableTokens, 8000);
  assert.equal(profile.openclaw_tokens_pause_actor_id, user);
  assert.equal(published[0].openclawInstance, null);
  assert.equal(published[0].deltaTokens, 0);
  assert.equal((await route.PATCH(request({ paused: true, confirmation: 'PAUSE' }))).status, 200);
  assert.equal(updates, 1, 'repeat confirmation does not re-pause');
  assert.equal((await route.PATCH(request({ paused: false }))).status, 200);
  assert.equal(profile.openclaw_tokens_paused, false);
  assert.equal(profile.llm_token_quota - profile.llm_token_used, 8000);
});

test('pause button opens a typed confirmation and cancelling sends no request', async () => {
  const values = [], requests = [];
  let cursor = 0, updated;
  const previousFetch = global.fetch;
  global.fetch = async (_url, options) => { requests.push(JSON.parse(options.body)); return Response.json({ pause: { openclawTokensPaused: true }, balance: { llmTokenQuota: 10000, llmTokenUsed: 0 } }); };
  function ConfirmDialog() { return null; }
  const { SettingsTokenUsageCard } = compile('components/settings-token-usage-card.tsx', {
    react: { ...React, useState: initial => { const index = cursor++; if (!(index in values)) values[index] = initial; return [values[index], value => { values[index] = value; }]; } },
    '@/components/language-provider': language, '@/components/confirm-dialog': { ConfirmDialog }
  });
  function render() { cursor = 0; return SettingsTokenUsageCard({ tokenQuota: 10000, tokenUsed: 0, onPauseChange: pause => { updated = pause; } }); }
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    return React.Children.toArray(node.props?.children).map(child => find(child, predicate)).find(Boolean);
  }
  try {
    let tree = render();
    find(tree, node => node.type === 'button').props.onClick();
    let dialog = find(render(), node => node.type === ConfirmDialog);
    assert.equal(dialog.props.open, true);
    assert.equal(dialog.props.confirmWord, 'PAUSE');
    assert.equal(requests.length, 0);
    dialog.props.onCancel();
    assert.equal(find(render(), node => node.type === ConfirmDialog).props.open, false);
    assert.equal(requests.length, 0);
    find(render(), node => node.type === 'button').props.onClick();
    dialog = find(render(), node => node.type === ConfirmDialog);
    dialog.props.onConfirm();
    await new Promise(setImmediate);
    assert.deepEqual(requests, [{ paused: true, confirmation: 'PAUSE' }]);
    assert.equal(updated.openclawTokensPaused, true);
    assert.equal(find(render(), node => node.type === ConfirmDialog).props.open, false);
  } finally { global.fetch = previousFetch; }
});

test('admin pause history requires MFA, filters by user, and displays Singapore timestamps', async () => {
  let allowed = false, queried = false;
  const filters = [];
  const query = { select() { queried = true; return this; }, in(...args) { filters.push(args); return this; }, eq(...args) { filters.push(args); return this; }, order() { return this; }, range() { return this; }, then(resolve) { return Promise.resolve({ data: [{ id: 'event-1', target_user_id: user, target_email: 'person@example.test', admin_email: 'person@example.test', action: 'ai_usage_paused', created_at: '2026-11-05T05:23:11Z', details: {} }], error: null }).then(resolve); } };
  const page = compile('app/admin/ai-pauses/page.tsx', {
    '@/lib/admin': { requireAdminPage: async options => { assert.equal(options.requireMfa, true); assert.equal(options.requireServiceRole, true); return { ok: allowed, adminSupabase: { from: () => query } }; } },
    '@/components/language-provider': language, '@/components/atmosphere': { Atmosphere: () => null }, '@/components/dashboard-sidebar': { DashboardSidebar: () => null }
  });
  assert.match(renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({}) })), /Admin unavailable/);
  assert.equal(queried, false);
  allowed = true;
  const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ user, event: 'paused' }) }));
  assert.match(html, /person@example.test/);
  assert.match(html, /13:23:11 SGT/);
  assert.match(html, /Paused AI usage/);
  assert.ok(filters.some(([field, value]) => field === 'target_user_id' && value === user));
  assert.ok(filters.some(([field, value]) => field === 'action' && value[0] === 'ai_usage_paused'));
});
