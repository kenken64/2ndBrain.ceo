const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

test("skipping Telegram completes onboarding without pairing either agent", async () => {
  let target = "hermes_agent";
  let writes = [], pairs = 0;
  const profile = { owner_name: "Owner", avatar_name: "Assistant", avatar_gender: "female", avatar_glb_path: "avatar.glb", openclaw_instance: "instance", openclaw_provision_status: "ready", openclaw_provision_completed_at: "now", openclaw_identity_completed_at: "now", openclaw_remotion_completed_at: "now" };
  const supabase = { auth: { getClaims: async () => ({ data: { claims: { sub: "user-1" } }, error: null }) }, from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { ...profile, provision_target: target } }), update(value) { writes.push(value); return this; }, then(resolve) { resolve({ error: null }); } }) };
  const mocks = {
    "next/server": { NextResponse: { redirect: url => ({ url: String(url) }) } },
    "@/lib/env": { hasSupabaseEnv: () => true },
    "@/lib/onboarding": { getUserIdFromClaims: c => c?.sub, getSelectedProvisionTarget: p => p.provision_target, onboardingPath: (next, step) => `/onboarding?step=${step}`, onboardingProfileSelect: "id" },
    "@/lib/openclaw": { pairHermesTelegram: async () => { pairs++; return { output: "approved" }; }, pairOpenClawTelegram: async () => { pairs++; return { output: "approved" }; }, setOpenClawTtyProxyInstance: async () => ({}), setupOpenClawAvatar: async () => ({}), setupOpenClawIdentity: async () => ({}) },
    "@/lib/supabase/server": { createClient: async () => supabase },
    "@/lib/url": { appUrl: value => new URL(value, "https://example.test"), safeNextPath: value => value }
  };
  const filename = path.resolve(__dirname, "../app/api/openclaw/telegram-pair/route.ts");
  const instance = new Module(filename, module); instance.paths = module.paths;
  const original = Module._load;
  try {
    Module._load = function (request, parent, main) { return Object.hasOwn(mocks, request) ? mocks[request] : original.apply(this, arguments); };
    instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
  } finally { Module._load = original; }
  for (target of ["openclaw", "hermes_agent"]) {
    writes = [];
    const form = new FormData(); form.set("action", "skip"); form.set("next", "/dashboard/chat");
    const result = await instance.exports.POST({ formData: async () => form });
    assert.equal(result.url, "https://example.test/dashboard/chat");
    const final = writes.find(item => item.onboarding_completed_at);
    assert.equal(final.openclaw_telegram_pair_status, "skipped");
    assert.equal(final.openclaw_telegram_pair_completed_at, null);
  }
  assert.equal(pairs, 0);
  target = "hermes_agent"; writes = [];
  const pairForm = new FormData(); pairForm.set("telegramPairCode", "ABCDEFGH"); pairForm.set("next", "/dashboard/chat");
  const paired = await instance.exports.POST({ formData: async () => pairForm });
  assert.equal(paired.url, "https://example.test/dashboard/chat");
  assert.equal(pairs, 1);
  const final = writes.find(item => item.onboarding_completed_at);
  assert.equal(final.openclaw_telegram_pair_status, "ready");
  assert.ok(final.openclaw_telegram_pair_completed_at);
});
