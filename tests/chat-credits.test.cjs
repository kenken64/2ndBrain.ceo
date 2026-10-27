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
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;
      create table public.profiles (id uuid primary key, admin_disabled boolean default false,
        admin_deleted_at timestamptz, llm_token_quota bigint not null, llm_token_used bigint not null);
      create table public.credit_ledger (user_id uuid not null, delta_tokens bigint not null,
        balance_after bigint not null check(balance_after >= 0), reason text not null, metadata jsonb not null);
    `);
    await db.exec(fs.readFileSync(path.join(__dirname, "../supabase/migrations/0028_chat_credits.sql"), "utf8"));
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

    await db.exec("set role authenticated");
    await assert.rejects(reserve(user, 1), /permission denied/);
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
