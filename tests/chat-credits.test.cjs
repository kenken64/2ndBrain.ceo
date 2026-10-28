const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

const user = "00000000-0000-0000-0000-000000000001";
const admin = "00000000-0000-0000-0000-000000000002";

test("chat reservations and reconciliation preserve balances and restrict access", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user_id', true), '')::uuid$$;
      create table public.profiles (id uuid primary key, admin_disabled boolean default false,
        admin_deleted_at timestamptz, llm_token_quota bigint not null, llm_token_used bigint not null);
      create table public.credit_ledger (user_id uuid not null, delta_tokens bigint not null,
        balance_after bigint not null check(balance_after >= 0), reason text not null, metadata jsonb not null);
    `);
    await db.exec(fs.readFileSync(path.join(__dirname, "../supabase/migrations/0028_chat_credits.sql"), "utf8"));
    await db.exec(fs.readFileSync(path.join(__dirname, "../supabase/migrations/0029_chat_usage_itemization.sql"), "utf8"));
    await db.exec(fs.readFileSync(path.join(__dirname, "../supabase/migrations/0030_chat_usage_summary.sql"), "utf8"));
    await db.exec(fs.readFileSync(path.join(__dirname, "../supabase/migrations/0034_chat_pdf_generation.sql"), "utf8"));
    await db.query("insert into auth.users(id) values ($1),($2)", [user, admin]);
    await db.query("insert into profiles(id,llm_token_quota,llm_token_used) values ($1,1000,100),($2,0,0)", [user, admin]);
    const reserve = (who, amount, exempt = false) => db.query("select * from reserve_chat_credits($1,$2,$3,$4)", [who, "test/model", amount, exempt]);
    const settle = (who, id, status, credits, cost, providerId = null) => db.query("select * from settle_chat_credits($1,$2,$3,$4,$5,$6)", [who, id, status, credits, cost, providerId]);

    let result = await reserve(user, 400);
    const requestId = result.rows[0].request_id;
    assert.equal(Number(result.rows[0].llm_token_used), 500);
    await assert.rejects(reserve(user, 600), /insufficient_ai_credits/);
    result = await settle(user, requestId, "completed", 150, 0.0006, "gen-1");
    assert.equal(Number(result.rows[0].llm_token_used), 250);
    assert.equal(Number(result.rows[0].charged_credits), 150);
    await assert.rejects(settle(user, requestId, "completed", 150, 0.0006), /chat_request_not_reserved/);

    result = await reserve(user, 300);
    const uncertainId = result.rows[0].request_id;
    await settle(user, uncertainId, "uncertain", 0, null);
    result = await settle(user, uncertainId, "completed", 40, 0.00016, "gen-2");
    assert.equal(Number(result.rows[0].llm_token_used), 290);
    result = await db.query("select sum(delta_tokens)::bigint as total from credit_ledger where user_id=$1", [user]);
    assert.equal(Number(result.rows[0].total), -190);

    result = await reserve(user, 200);
    result = await settle(user, result.rows[0].request_id, "failed", 0, null);
    assert.equal(Number(result.rows[0].llm_token_used), 290);
    result = await reserve(admin, 100, true);
    result = await settle(admin, result.rows[0].request_id, "completed", 20, 0.00008);
    assert.equal(Number(result.rows[0].llm_token_used), 0);

    result = await db.query("select * from reserve_chat_credits_itemized($1,$2,$3,$4,$5,$6)", [user, "google/gemini-2.5-flash", 100, false, "pdf_ocr", 3]);
    const itemId = result.rows[0].request_id;
    await db.query("select * from settle_chat_credits_itemized($1,$2,$3,$4,$5,$6,$7,$8)", [user, itemId, "completed", 25, 0.0001, "gen-item", 100, 25]);
    const item = (await db.query("select * from chat_credit_requests where id=$1", [itemId])).rows[0];
    assert.equal(item.request_kind, "pdf_ocr"); assert.equal(item.pdf_pages, 3); assert.equal(Number(item.prompt_tokens), 100); assert.equal(Number(item.cost_usd), 0.0001);
    await assert.rejects(db.query("select * from reserve_chat_credits_itemized($1,$2,$3,$4,$5,$6)", [user, "model", 1, false, "pdf_ocr", null]), /invalid_chat_usage_details/);
    result = await db.query("select * from reserve_chat_credits_itemized($1,$2,$3,$4,$5,$6)", [user, "model", 100, false, "pdf_generation", null]);
    await db.query("select * from settle_chat_credits_itemized($1,$2,$3,$4,$5,$6,$7,$8)", [user, result.rows[0].request_id, "completed", 10, 0.00004, "gen-batch", 20, 10]);
    await db.exec("grant usage on schema public, auth to authenticated; grant select on public.chat_credit_requests to authenticated");
    await db.exec(`set test.user_id = '${user}'`);
    await db.exec("set role authenticated");
    const summary = await db.query("select * from current_user_chat_usage_summary()");
    const pdf = summary.rows.find(row => row.request_kind === "pdf_ocr");
    assert.equal(Number(pdf.completed_count), 1); assert.equal(Number(pdf.completed_credits), 25); assert.equal(Number(pdf.provider_cost_usd), 0.0001);
    assert.equal(Number(summary.rows.find(row => row.request_kind === "pdf_generation").completed_credits), 10);
    const chat = summary.rows.find(row => row.request_kind === "chat");
    assert.equal(Number(chat.completed_credits), 190); assert.equal(Number(chat.failed_count), 1);
    const visible = await db.query("select distinct user_id from chat_credit_requests");
    assert.deepEqual(visible.rows.map(row => row.user_id), [user]);
    await assert.rejects(reserve(user, 1), /permission denied/);
    await assert.rejects(db.query("select * from reserve_chat_credits_itemized($1,$2,$3,$4,$5,$6)", [user, "model", 1, false, "chat", null]), /permission denied/);
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
