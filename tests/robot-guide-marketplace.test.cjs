const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function compile(file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', file);
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = module.paths;
  const original = Module._load;
  try {
    Module._load = function (request, ...args) { return Object.hasOwn(mocks, request) ? mocks[request] : original.call(this, request, ...args); };
    instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  } finally { Module._load = original; }
  return instance.exports;
}
const allocation = compile('lib/workflow-tool-allocations.ts');
const catalog = compile('lib/workflow-templates.ts', { '@/lib/workflow-tool-allocations': allocation });
const messages = compile('lib/ui-messages.ts');
const guide = catalog.marketplaceItemById('two-wheel-robot-guide');

test('robot guide installs for free without a credit balance', async () => {
  let rpcInput; let published = false;
  const admin = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { email: 'person@example.com', openclaw_instance: null } }) }) }) }),
    rpc: (_name, input) => { rpcInput = input; return { single: async () => ({ data: { install_id: 'install', allocation_id: 'allocation', item_id: guide.id, item_type: guide.itemType, status: 'installed', price_tokens: 0, charged_tokens: 0, allocated_tokens: 0, used_tokens: 0, quota_exempt: true, llm_token_quota: 0, llm_token_used: 50, available_tokens: 0, already_installed: false } }) }; }
  };
  const route = compile('app/api/marketplace/install/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/admin': { isAdminUser: async () => false }, '@/lib/env': { hasSupabaseEnv: () => true },
    '@/lib/onboarding': { getUserIdFromClaims: claims => claims?.sub },
    '@/lib/supabase/admin': { createAdminClient: () => admin, hasSupabaseServiceRoleEnv: () => true },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: 'user', email: 'person@example.com' } } }) } }) },
    '@/lib/token-quota-redis': { publishTokenQuotaUpdate: async () => { published = true; } },
    '@/lib/workflow-templates': catalog, '@/lib/workflow-tool-allocations': allocation
  });
  const response = await route.POST({ json: async () => ({ itemId: guide.id }) });
  assert.equal(response.status, 200);
  assert.equal(rpcInput.p_price_tokens, 0);
  assert.equal(rpcInput.p_is_admin, true);
  assert.equal(rpcInput.p_item_type, 'workflow');
  assert.equal(response.body.install.chargedTokens, 0);
  assert.equal(published, false);
});

test('marketplace offers installation with no credits or agent setup', () => {
  const states = [{ isAdmin: false, balance: { availableTokens: 0 }, installs: [] }, null, null, false, null, 1, 12, 'two wheel'];
  const fakeReact = { ...React, useState: () => [states.shift(), () => {}], useEffect: () => {}, useMemo: callback => callback() };
  const lang = { useLanguage: () => ({ language: 'en' }), Localized: ({ en }) => en, LocalizedMessage: ({ text }) => text };
  const { WorkflowMarketplace } = compile('components/workflow-marketplace.tsx', { react: fakeReact, '@/components/language-provider': lang, '@/lib/workflow-templates': catalog, '@/lib/ui-messages': messages });
  const html = renderToStaticMarkup(React.createElement(WorkflowMarketplace, { setupComplete: false }));
  assert.match(html, /Free · External guide/);
  assert.match(html, /<button class="btn-primary" type="button">/);
  assert.doesNotMatch(html, /Complete workspace setup before installing/);
});

test('installed guide opens the supplied site in My Workflows', () => {
  const installed = { itemId: guide.id, status: 'installed', chargedTokens: 0, priceTokens: 0, allocation: null };
  const states = [[installed], null, null, false, false, null, null];
  const fakeReact = { ...React, useState: () => [states.shift(), () => {}], useEffect: () => {}, useMemo: callback => callback() };
  const lang = { useLanguage: () => ({ language: 'en' }), Localized: ({ en }) => en, LocalizedMessage: ({ text }) => text };
  const { MyWorkflows } = compile('components/my-workflows.tsx', { react: fakeReact, '@/components/language-provider': lang, '@/lib/workflow-templates': catalog });
  const html = renderToStaticMarkup(React.createElement(MyWorkflows, { setupComplete: false }));
  assert.match(html, /Open guide/);
  assert.ok(html.includes(`href="${guide.externalUrl}"`));
  assert.match(html, /target="_blank"/);
  assert.match(html, /Free, no recurring charges/);
});
