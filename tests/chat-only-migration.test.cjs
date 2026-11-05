const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

test("chat-only migration preserves agent options and permits chat-only registration", async () => {
  const db = new PGlite();
  try {
    await db.exec("create table profiles (provision_target text)");
    for (const file of ["0011_agent_provision_target.sql", "0044_chat_only_onboarding.sql"]) await db.exec(fs.readFileSync(path.join(__dirname, "../supabase/migrations", file), "utf8"));
    await db.exec("insert into profiles values ('openclaw'), ('hermes_agent'), ('chat_only'), (null)");
    await assert.rejects(db.exec("insert into profiles values ('unknown')"), /profiles_provision_target_check/);
  } finally { await db.close(); }
});
