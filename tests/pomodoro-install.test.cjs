const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

test("free timer installs, renews, removes and reinstalls without spending credits", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
      create table public.profiles (id uuid primary key, admin_disabled boolean default false, admin_deleted_at timestamptz, llm_token_quota bigint not null default 0, llm_token_used bigint not null default 0);
      create table public.credit_ledger (id uuid primary key default gen_random_uuid(), user_id uuid, delta_tokens bigint, balance_after bigint, reason text, metadata jsonb);
    `);
    for (const file of ["0019_marketplace_tool_allocations.sql", "0020_marketplace_tool_unsubscribe.sql"]) {
      await db.exec(fs.readFileSync(path.resolve(__dirname, "../supabase/migrations", file), "utf8"));
    }
    const user = "00000000-0000-0000-0000-000000000001";
    await db.query("insert into auth.users(id) values ($1)", [user]);
    await db.query("insert into public.profiles(id,llm_token_quota,llm_token_used) values ($1,0,50)", [user]);
    const install = () => db.query("select * from public.install_marketplace_tool($1,'pomodoro-timer','agent-app','Pomodoro Timer',0,null,true,'{}'::jsonb)", [user]);
    const first = (await install()).rows[0];
    assert.equal(Number(first.charged_tokens), 0);
    assert.equal(first.status, "installed");
    assert.equal(first.already_installed, false);
    assert.equal((await install()).rows[0].already_installed, true);
    await db.exec("update public.marketplace_installs set next_charge_at = now() - interval '1 day'");
    const renewed = (await db.query("select * from public.sync_marketplace_tool_subscriptions($1,false)", [user])).rows[0];
    assert.equal(Number(renewed.charged_tokens), 0);
    assert.equal(renewed.status, "installed");
    const removed = (await db.query("select * from public.unsubscribe_marketplace_tool($1,'pomodoro-timer')", [user])).rows[0];
    assert.equal(Number(removed.refunded_tokens), 0);
    assert.equal(removed.status, "uninstalled");
    assert.equal((await install()).rows[0].status, "installed");
    assert.equal(Number((await db.query("select count(*) as count from public.credit_ledger")).rows[0].count), 0);
    assert.equal(Number((await db.query("select llm_token_quota from public.profiles where id=$1", [user])).rows[0].llm_token_quota), 0);
  } finally { await db.close(); }
});
