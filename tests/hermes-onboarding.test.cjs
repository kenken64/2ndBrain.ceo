const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../lib/onboarding.ts");
const instance = new Module(filename, module);
instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText, filename);
const { getRequiredOnboardingStep, isOnboardingComplete } = instance.exports;

const ready = {
  owner_name: "Owner", avatar_name: "Agent", avatar_gender: "female", telegram_bot_token: "123:token",
  enrolment_completed_at: "now", avatar_glb_path: "avatar.glb", avatar_completed_at: "now",
  provision_target: "hermes_agent", openclaw_instance: "openclaw-12345678",
  openclaw_provision_status: "ready", openclaw_provision_completed_at: "now",
  openclaw_telegram_pair_status: "ready", openclaw_telegram_pair_completed_at: "now", onboarding_completed_at: "now"
};

test("Hermes onboarding requires a provisioned host and a completed or skipped Telegram step", () => {
  assert.equal(isOnboardingComplete(ready), true);
  assert.equal(getRequiredOnboardingStep(ready), null);
  assert.equal(getRequiredOnboardingStep({ ...ready, openclaw_instance: null }), "provision");
  assert.equal(getRequiredOnboardingStep({ ...ready, openclaw_telegram_pair_completed_at: null }), "approval");
  assert.equal(isOnboardingComplete({ ...ready, openclaw_telegram_pair_completed_at: null }), false);
  for (const target of ["openclaw", "hermes_agent"]) {
    const skipped = { ...ready, provision_target: target, telegram_bot_token: null, openclaw_telegram_pair_status: "skipped", openclaw_telegram_pair_completed_at: null };
    assert.equal(getRequiredOnboardingStep(skipped), null);
    assert.equal(isOnboardingComplete(skipped), true);
    assert.equal(getRequiredOnboardingStep({ ...skipped, onboarding_completed_at: null }), "approval");
  }
  assert.equal(getRequiredOnboardingStep({ ...ready, telegram_bot_token: null, enrolment_completed_at: "now", avatar_completed_at: null }), "avatar");
});

test("OpenClaw and legacy profiles retain the existing onboarding path", () => {
  assert.equal(isOnboardingComplete({ ...ready, provision_target: "openclaw" }), true);
  assert.equal(isOnboardingComplete({ ...ready, provision_target: null }), true);
  assert.equal(getRequiredOnboardingStep({ ...ready, provision_target: "unknown" }), "agent");
});

test("chat-only registration completes without an agent while keeping profile requirements", () => {
  const chatOnly = { ...ready, provision_target: "chat_only", openclaw_instance: null, openclaw_provision_status: "skipped", openclaw_provision_completed_at: null, openclaw_telegram_pair_status: null, openclaw_telegram_pair_completed_at: null, telegram_bot_token: null };
  assert.equal(isOnboardingComplete(chatOnly), true);
  assert.equal(getRequiredOnboardingStep(chatOnly), null);
  assert.equal(isOnboardingComplete({ ...chatOnly, onboarding_completed_at: null }), false);
  assert.equal(getRequiredOnboardingStep({ ...chatOnly, onboarding_completed_at: null }), "agent");
  assert.equal(getRequiredOnboardingStep({ ...chatOnly, avatar_completed_at: null }), "avatar");
  assert.equal(isOnboardingComplete({ ...chatOnly, owner_name: "" }), false);
});

test("registration accepts either supported agent and rejects unknown targets", async () => {
  const routeFile = path.resolve(__dirname, "../app/api/onboarding/route.ts");
  const routeModule = new Module(routeFile, module);
  const writes = [];
  let profile = { ...ready, openclaw_instance: null, openclaw_provision_status: null };
  let race = false;
  const supabase = {
    auth: { getClaims: async () => ({ data: { claims: { sub: "user-id", email: "user@example.com" } } }) },
    from: () => ({ upsert: async (row) => { writes.push(row); return { error: null }; }, select() { return this; }, eq() { return this; }, is() { return this; }, or() { return this; }, update(row) { writes.push(row); this.updated = true; return this; }, async maybeSingle() { return { data: this.updated ? (race ? null : { id: "user-id" }) : profile, error: null }; } })
  };
  const mocks = {
    "next/server": { NextResponse: { redirect: (url) => ({ url: String(url) }) } },
    "@/lib/avaturn": {},
    "@/lib/env": { hasSupabaseEnv: () => true },
    "@/lib/onboarding": instance.exports,
    "@/lib/supabase/server": { createClient: async () => supabase },
    "@/lib/url": { appUrl: (value) => `https://example.com${value}`, safeNextPath: (value) => value }
  };
  const originalLoad = Module._load;
  try {
    Module._load = function (request, parent, main) {
      return Object.hasOwn(mocks, request) ? mocks[request] : originalLoad.apply(this, arguments);
    };
    routeModule._compile(ts.transpileModule(fs.readFileSync(routeFile, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText, routeFile);
  } finally { Module._load = originalLoad; }
  for (const target of ["openclaw", "hermes_agent"]) {
    const form = new FormData(); form.set("step", "agent"); form.set("provisionTarget", target);
    const response = await routeModule.exports.POST({ formData: async () => form });
    assert.match(response.url, /step=provision/);
    assert.equal(writes.at(-1).provision_target, target);
  }
  const enrolment = new FormData(); enrolment.set("step", "enrolment"); enrolment.set("ownerName", "Owner"); enrolment.set("avatarName", "Agent"); enrolment.set("avatarGender", "female");
  assert.match((await routeModule.exports.POST({ formData: async () => enrolment })).url, /step=avatar/);
  assert.equal(writes.at(-1).telegram_bot_token, null);
  const skip = new FormData(); skip.set("step", "agent"); skip.set("provisionTarget", "chat_only");
  assert.equal((await routeModule.exports.POST({ formData: async () => skip })).url, "https://example.com/dashboard/chat");
  assert.equal(writes.at(-1).provision_target, "chat_only");
  assert.ok(writes.at(-1).onboarding_completed_at);
  profile = { ...profile, openclaw_provision_status: "running" };
  assert.match((await routeModule.exports.POST({ formData: async () => skip })).url, /openclaw_provision_running/);
  profile = { ...profile, openclaw_provision_status: null }; race = true;
  assert.match((await routeModule.exports.POST({ formData: async () => skip })).url, /openclaw_provision_running/);
  const invalid = new FormData(); invalid.set("step", "agent"); invalid.set("provisionTarget", "unexpected");
  assert.match((await routeModule.exports.POST({ formData: async () => invalid })).url, /invalid_provision_target/);
  assert.equal(writes.length, 5);
});
