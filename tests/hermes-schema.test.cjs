const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

test("agent types preserve OpenClaw defaults and instance secrets are owner-isolated", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
      create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
    `);
    for (const file of ["0023_openclaw_instances.sql", "0041_instance_agent_type.sql"]) {
      await db.exec(fs.readFileSync(path.resolve(__dirname, "../supabase/migrations", file), "utf8"));
    }
    await db.exec(`
      insert into auth.users values ('00000000-0000-0000-0000-000000000001');
      insert into public.openclaw_instances (id,user_id,consumer_name) values
        ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','consumer');
      insert into public.agent_instance_secrets values ('00000000-0000-0000-0000-000000000002', 'private-token');
      grant usage on schema public to authenticated;
      grant select on public.agent_instance_secrets to authenticated;
    `);
    assert.equal((await db.query("select agent_type from public.openclaw_instances")).rows[0].agent_type, "openclaw");
    await assert.rejects(db.exec("update public.openclaw_instances set agent_type='invalid'"));
    await db.exec("set role authenticated");
    assert.deepEqual((await db.query("select * from public.agent_instance_secrets")).rows, []);
    await db.exec("reset role; delete from public.openclaw_instances");
    assert.deepEqual((await db.query("select * from public.agent_instance_secrets")).rows, []);
  } finally {
    await db.close();
  }
});
