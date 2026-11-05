const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('card payments are bound, atomic, idempotent and reconcile out-of-order refunds', async () => {
  const db = new PGlite();
  const user = '00000000-0000-0000-0000-000000000001';
  const other = '00000000-0000-0000-0000-000000000002';
  const first = '00000000-0000-4000-8000-000000000001';
  const second = '00000000-0000-4000-8000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create table auth.users (id uuid primary key);
      create table profiles (id uuid primary key, llm_token_quota bigint not null check(llm_token_quota >= 0), llm_token_used bigint not null check(llm_token_used >= 0));
      create table credit_ledger (user_id uuid not null, delta_tokens bigint not null, balance_after bigint not null check(balance_after >= 0), reason text, metadata jsonb);`);
    await db.exec(fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/0045_lemon_squeezy_credits.sql'), 'utf8'));
    await db.query('insert into auth.users values ($1), ($2)', [user, other]);
    await db.query('insert into profiles values ($1, 100, 0), ($2, 0, 0)', [user, other]);
    await db.query("insert into lemon_credit_checkouts(id,user_id,store_id,variant_id,test_mode,package_tokens,usd_amount_cents) values ($1,$3,'1','2',false,7500000,3000),($2,$3,'1','2',false,7500000,3000)", [first, second, user]);
    const apply = (intent, order, refund, overrides = {}) => db.query('select * from apply_lemon_credit_order($1,$2,$3,$4,$5,$6,$7,$8,$9)', [intent, order, overrides.store ?? '1', overrides.variant ?? '2', overrides.test ?? false, overrides.subtotal ?? 3000, overrides.discount ?? 0, overrides.total ?? 3300, refund]);
    await assert.rejects(apply(first, '123', 0, { variant: '3' }), /lemon_order_mismatch/);
    await assert.rejects(apply(first, '123', 0, { discount: 1 }), /lemon_order_mismatch/);
    await assert.rejects(apply(first, '123', 0, { test: true }), /lemon_order_mismatch/);
    assert.equal(Number((await apply(first, '123', 0)).rows[0].delta_tokens), 7500000);
    assert.equal(Number((await apply(first, '123', 0)).rows[0].delta_tokens), 0);
    await assert.rejects(apply(first, '124', 0), /lemon_intent_already_used/);
    await assert.rejects(apply(second, '123', 0), /duplicate key/);
    await db.query('update profiles set llm_token_used=7500000 where id=$1', [user]);
    const partial = (await apply(first, '123', 1650)).rows[0];
    assert.equal(Number(partial.delta_tokens), -3750000);
    assert.equal(Number(partial.llm_token_quota), 3750100);
    assert.equal(Number(partial.llm_token_used), 7500000);
    assert.equal(Number((await apply(first, '123', 1650)).rows[0].delta_tokens), 0);
    assert.equal(Number((await apply(first, '123', 0)).rows[0].delta_tokens), 0);
    assert.equal(Number((await apply(first, '123', 3300)).rows[0].delta_tokens), -3750000);
    assert.equal((await apply(first, '123', 0)).rows[0].order_status, 'refunded');
    // A refund after credits were transferred away still creates a recoverable deficit.
    await db.query('update profiles set llm_token_quota=0 where id=$1', [user]);
    const third = '00000000-0000-4000-8000-000000000003';
    await db.query("insert into lemon_credit_checkouts(id,user_id,store_id,variant_id,test_mode,package_tokens,usd_amount_cents) values ($1,$2,'1','2',false,7500000,3000)", [third, user]);
    await apply(third, '126', 0);
    await db.query('update profiles set llm_token_quota=0 where id=$1', [user]);
    const debt = (await apply(third, '126', 3300)).rows[0];
    assert.equal(Number(debt.llm_token_quota), 0);
    assert.equal(Number(debt.llm_token_used), 15000000);
    assert.equal(Number((await apply(second, '125', 3300)).rows[0].delta_tokens), 0);
    assert.equal(Number((await apply(second, '125', 0)).rows[0].delta_tokens), 0);
    const ledgers = (await db.query('select delta_tokens from credit_ledger order by delta_tokens')).rows;
    assert.deepEqual(ledgers.map(row => Number(row.delta_tokens)), [-7500000, -3750000, -3750000, 7500000, 7500000]);
    assert.equal(Number((await db.query('select llm_token_quota from profiles where id=$1', [other])).rows[0].llm_token_quota), 0);
    await db.exec('grant usage on schema public to authenticated; set role authenticated');
    await assert.rejects(apply(first, '123', 0), /permission denied/);
  } finally { await db.close(); }
});
