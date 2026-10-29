const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');

test('video jobs restrict visibility to the owner and prevent direct writes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create table auth.users(id uuid primary key); create table public.chat_credit_requests(id uuid primary key); create table public.chat_files(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.user_id', true), '')::uuid $$;`);
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/0037_chat_video_jobs.sql'), 'utf8'));
    const alice = '00000000-0000-4000-8000-000000000001', bob = '00000000-0000-4000-8000-000000000002';
    await db.query('insert into auth.users values ($1),($2)', [alice, bob]);
    await db.query('insert into chat_credit_requests values ($1),($2)', [alice, bob]);
    await db.query('insert into chat_video_jobs(user_id,credit_request_id) values ($1,$1),($2,$2)', [alice, bob]);
    await db.exec(`grant usage on schema public,auth to authenticated; set test.user_id = '${alice}'; set role authenticated`);
    assert.deepEqual((await db.query('select user_id from chat_video_jobs')).rows.map(row => row.user_id), [alice]);
    await assert.rejects(db.query("update chat_video_jobs set status='completed'"), /permission denied/);
  } finally { await db.close(); }
});

test('video generation preserves jobs, settles actual cost and saves the completed video', async () => {
  const jobId = '00000000-0000-4000-8000-000000000001';
  let state;
  const reset = () => { state = { auth: true, calls: [], job: null, mode: 'ok', ledger: { status: 'reserved', quota_exempt: false } }; };
  const admin = {
    rpc(name, args) { return { single: async () => {
      state.calls.push({ name, args });
      if (name === 'reserve_chat_credits_itemized') return state.mode === 'insufficient' ? { data: null, error: { message: 'insufficient_ai_credits' } } : { data: { request_id: 'credit-1', llm_token_quota: 50000, llm_token_used: args.p_credits }, error: null };
      state.ledger.status = args.p_status;
      return { data: { llm_token_quota: 50000, llm_token_used: args.p_actual_credits, charged_credits: args.p_actual_credits }, error: null };
    } }; },
    from(table) {
      let operation = 'select', payload, matches = {};
      const query = {
        select() { return query; }, eq(key, value) { matches[key] = value; return query; }, or() { return query; }, order() { return query; },
        insert(value) { operation = 'insert'; payload = value; return query; }, update(value) { operation = 'update'; payload = value; return query; },
        async limit() { return { data: state.job && matches.user_id === state.job.user_id ? [state.job] : [], error: null }; },
        async single() { if (table === 'chat_video_jobs' && operation === 'insert') { state.job = { id: jobId, status: 'submitting', provider_job_id: null, output_file_id: null, ...payload }; return { data: { id: jobId }, error: null }; } if (table === 'chat_video_jobs' && operation === 'update' && matches.id === state.job?.id && matches.user_id === state.job.user_id) { Object.assign(state.job, payload); return { data: { id: jobId }, error: null }; } return { data: null, error: {} }; },
        async maybeSingle() {
          if (table === 'profiles') return { data: { email: 'test@example.test', openclaw_instance: null }, error: null };
          if (table === 'chat_credit_requests') return { data: matches.user_id === 'user-1' ? state.ledger : null, error: null };
          if (table === 'chat_video_jobs' && operation === 'update' && state.job?.id === matches.id && state.job.user_id === matches.user_id && state.job.status === matches.status) { Object.assign(state.job, payload); return { data: { ...state.job }, error: null }; }
          return { data: null, error: null };
        },
        then(resolve) { if (table === 'chat_video_jobs' && operation === 'update' && state.job?.id === matches.id && state.job.user_id === matches.user_id) Object.assign(state.job, payload); return Promise.resolve({ error: null }).then(resolve); }
      };
      return query;
    }
  };
  const mocks = {
    '@/lib/admin': { isAdminUser: async () => false },
    '@/lib/chat-files': { saveChatGeneratedVideo: async (_admin, user, bytes) => { state.saved = { user, bytes }; return { id: 'file-1', name: 'video.mp4' }; } },
    '@/lib/env': { hasSupabaseEnv: () => true },
    '@/lib/onboarding': { getUserIdFromClaims: claims => claims?.sub },
    '@/lib/supabase/admin': { createAdminClient: () => admin, hasSupabaseServiceRoleEnv: () => true },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: state.auth ? { sub: 'user-1' } : null }, error: null }) } }) },
    '@/lib/token-quota-redis': { publishTokenQuotaUpdate: async () => true }
  };
  const filename = path.resolve(__dirname, '../app/api/chat/generate-video/route.ts');
  const instance = new Module(filename, module); instance.filename = filename; instance.paths = module.paths;
  const originalLoad = Module._load, originalFetch = global.fetch, originalKey = process.env.OPENROUTER_API_KEY;
  let route;
  try {
    Module._load = function(request, ...args) { return Object.hasOwn(mocks, request) ? mocks[request] : originalLoad.call(this, request, ...args); };
    instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
    route = instance.exports;
  } finally { Module._load = originalLoad; }
  process.env.OPENROUTER_API_KEY = 'test-key';
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/videos/models')) return Response.json({ data: [{ id: 'x-ai/grok-imagine-video-1.5-lite', supported_durations: state.mode === 'duration-unavailable' ? [3] : [3, 15], supported_resolutions: ['480p'], supported_aspect_ratios: ['16:9'], pricing_skus: { cents_per_video_output_second_480p: state.mode === 'bad-price' ? 'no' : '2' } }] });
    if (options.method === 'POST') { state.providerBody = JSON.parse(options.body); if (state.mode === 'network') throw Error('network'); return Response.json({ id: 'job-provider' }, { status: 202 }); }
    if (String(url).includes('/content?')) return new Response(Buffer.from('0000ftypmp42'));
    return Response.json({ status: state.mode === 'pending' ? 'pending' : 'completed', generation_id: 'gen-1', usage: state.mode === 'missing-usage' ? undefined : { cost: 0.05 } });
  };
  const req = (method, body, origin = 'http://localhost') => new Request('http://localhost/api/chat/generate-video', { method, headers: { 'content-type': 'application/json', host: 'localhost', origin }, body: JSON.stringify(body) });
  try {
    reset(); state.auth = false; assert.equal((await route.POST(req('POST', { prompt: 'ocean' }))).status, 401);
    reset(); assert.equal((await route.POST(req('POST', { prompt: 'ocean' }, 'http://evil.test'))).status, 403);
    reset(); state.mode = 'bad-price'; assert.equal((await route.POST(req('POST', { prompt: 'ocean' }))).status, 503); assert.equal(state.calls.length, 0);
    reset(); state.mode = 'duration-unavailable'; assert.equal((await route.POST(req('POST', { prompt: 'ocean' }))).status, 503); assert.equal(state.calls.length, 0); assert.equal(state.providerBody, undefined);
    reset(); state.mode = 'insufficient'; assert.equal((await route.POST(req('POST', { prompt: 'ocean' }))).status, 402); assert.equal(state.providerBody, undefined);
    reset(); const quote = await (await route.GET()).json(); assert.equal(quote.credits, 75000); assert.equal(quote.estimatedUsd, 0.3);
    const submitted = await (await route.POST(req('POST', { prompt: 'ocean' }))).json(); assert.equal(submitted.jobId, jobId);
    assert.equal(state.job.provider_job_id, 'job-provider'); assert.equal(state.providerBody.duration, 15); assert.equal(state.providerBody.model, 'x-ai/grok-imagine-video-1.5-lite'); assert.equal(state.calls[0].args.p_kind, 'video_generation'); assert.equal(state.calls[0].args.p_credits, 75000);
    state.mode = 'pending'; assert.equal((await (await route.PATCH(req('PATCH', { jobId }))).json()).status, 'pending'); assert.equal(state.calls.length, 1);
    state.mode = 'ok'; const done = await (await route.PATCH(req('PATCH', { jobId }))).json(); assert.equal(done.status, 'completed'); assert.equal(state.calls[1].args.p_cost_usd, 0.05); assert.equal(state.calls[1].args.p_actual_credits, 12500); assert.equal(state.saved.user, 'user-1'); assert.equal(state.job.output_file_id, 'file-1');
    await route.PATCH(req('PATCH', { jobId })); assert.equal(state.calls.length, 2);
    reset(); state.mode = 'network'; assert.equal((await route.POST(req('POST', { prompt: 'ocean' }))).status, 502); assert.equal(state.calls[1].args.p_status, 'uncertain'); assert.equal(state.job.status, 'uncertain');
    reset(); await route.POST(req('POST', { prompt: 'ocean' })); state.mode = 'missing-usage'; const unknown = await (await route.PATCH(req('PATCH', { jobId }))).json(); assert.equal(unknown.status, 'pending'); assert.equal(unknown.usagePending, true); assert.equal(state.calls[1].args.p_status, 'uncertain');
    const saved = state.saved; state.mode = 'ok'; const reconciled = await (await route.PATCH(req('PATCH', { jobId }))).json(); assert.equal(reconciled.status, 'completed'); assert.equal(state.saved, saved); assert.equal(state.calls[2].args.p_status, 'completed');
  } finally { global.fetch = originalFetch; if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey; }
});
