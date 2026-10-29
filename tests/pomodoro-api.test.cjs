const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

function compile(file, mocks = {}) {
  const filename = path.resolve(__dirname, "..", file);
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = module.paths;
  const original = Module._load;
  try {
    Module._load = function (request, parent, main) { return Object.hasOwn(mocks, request) ? mocks[request] : original.apply(this, arguments); };
    instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText, filename);
  } finally { Module._load = original; }
  return instance.exports;
}

test("the install route exempts the free timer from credit charges", async () => {
  let rpcInput;
  let published = false;
  const admin = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { email: "person@example.com", openclaw_instance: null } }) }) }) }),
    rpc: (name, input) => {
      assert.equal(name, "install_marketplace_tool");
      rpcInput = input;
      return { single: async () => ({ data: {
        install_id: "install", allocation_id: "allocation", item_id: "pomodoro-timer", item_type: "agent-app",
        status: "installed", price_tokens: 0, charged_tokens: 0, allocated_tokens: 0, used_tokens: 0,
        quota_exempt: true, llm_token_quota: 0, llm_token_used: 50, available_tokens: 0, already_installed: false
      } }) };
    }
  };
  const route = compile("app/api/marketplace/install/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/admin": { isAdminUser: async () => false },
    "@/lib/env": { hasSupabaseEnv: () => true },
    "@/lib/onboarding": { getUserIdFromClaims: (claims) => claims?.sub },
    "@/lib/supabase/admin": { createAdminClient: () => admin, hasSupabaseServiceRoleEnv: () => true },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "user", email: "person@example.com" } } }) } }) },
    "@/lib/token-quota-redis": { publishTokenQuotaUpdate: async () => { published = true; } },
    "@/lib/workflow-templates": { marketplaceItemById: (id) => id === "pomodoro-timer" ? { id, title: "Pomodoro Timer", itemType: "agent-app", priceTokens: 0, internalPath: "/dashboard/pomodoro" } : null },
    "@/lib/workflow-tool-allocations": { normalizeTokenAmount: (number) => Math.max(0, Number(number ?? 0)) }
  });
  const response = await route.POST({ json: async () => ({ itemId: "pomodoro-timer" }) });
  assert.equal(response.status, 200);
  assert.equal(rpcInput.p_price_tokens, 0);
  assert.equal(rpcInput.p_is_admin, true);
  assert.equal(response.body.install.chargedTokens, 0);
  assert.equal(published, false);
});

test("zero-credit users can reach the free app and its marketplace entry", async () => {
  const names = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY", "SERVICE_ROLE_KEY"];
  const previous = names.map((name) => process.env[name]);
  names.forEach((name) => { delete process.env[name]; });
  try {
    const profile = { admin_disabled: false, admin_deleted_at: null, llm_token_quota: 0, llm_token_used: 10, openclaw_tokens_paused: false };
    const response = { kind: "allowed" };
    const module = compile("proxy.ts", {
      "next/server": { NextResponse: { redirect: (url) => ({ kind: "redirect", url }), json: (body, options) => ({ kind: "json", body, status: options?.status }) } },
      "@/lib/env": { getSupabaseEnv: () => ({ supabaseUrl: "https://example.com" }) },
      "@/lib/supabase/proxy": { updateSession: async (_request, options) => options.onAuthenticated({
        email: "person@example.com", userId: "user", response,
        supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }) }
      }) },
      "@/lib/url": { appUrl: (url) => url }
    });
    for (const pathname of ["/dashboard/marketplace", "/dashboard/workflows", "/dashboard/pomodoro"]) {
      const result = await module.proxy({ nextUrl: { pathname, searchParams: new URLSearchParams() }, method: "GET" });
      assert.deepEqual(result, response);
    }
    const paid = await module.proxy({ nextUrl: { pathname: "/dashboard/chat", searchParams: new URLSearchParams() }, method: "GET" });
    assert.equal(paid.kind, "redirect");
    assert.match(paid.url, /creditStatus=empty/);
  } finally {
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
  }
});
