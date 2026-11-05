const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function compile(file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', file), instance = new Module(filename, module);
  instance.filename = filename; instance.paths = module.paths;
  const original = Module._load;
  try {
    Module._load = function(request, ...args) { return Object.hasOwn(mocks, request) ? mocks[request] : original.call(this, request, ...args); };
    instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  } finally { Module._load = original; }
  return instance.exports;
}
const { buildCreditOptions } = compile('lib/credit-pricing.ts');
const { CreditAmountReference } = compile('components/credit-amount-reference.tsx', {
  '@/lib/ai-credit-rates': require('./helpers/load-credit-rates.cjs'),
  '@/components/language-provider': { useLanguage: () => ({ language: 'en' }), Localized: ({ en }) => en }
});
test('reference displays purchased credits and alternative token estimates without the internal markup', () => {
  const options = { ...buildCreditOptions(0.78254, 5.2214, '2026-11-04'), textEstimate: { modelLabel: 'Gemini 2.5 Flash', inputUsdPerToken: 0.0000003, outputUsdPerToken: 0.0000025, checkedAt: '2026-11-05T00:00:00Z' } };
  const html = renderToStaticMarkup(React.createElement(CreditAmountReference, { options, selectedCents: 500 }));
  assert.match(html, /View credit amounts/); assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /977,500/); assert.match(html, /10,861,111/); assert.match(html, /1,303,333/);
  assert.match(html, /19,562,500/); assert.match(html, /cannot be added together/);
  assert.doesNotMatch(html, /20%|markup/i);
  const unavailable = renderToStaticMarkup(React.createElement(CreditAmountReference, { options: { ...options, textEstimate: null }, selectedCents: 500 }));
  assert.match(unavailable, /temporarily unavailable/); assert.match(unavailable, /977,500/);
});
test('token pricing is optional, validated, cached and taken from the reference model', async () => {
  const original = global.fetch; let calls = 0;
  global.fetch = async () => { calls++; return Response.json({ data: [{ id: 'default', pricing: { prompt: '0.0000003', completion: '0.0000025' } }] }); };
  const mocks = { 'server-only': {}, '@/lib/chat-models': { CHAT_MODELS: [{ id: 'default', label: 'Default' }] } };
  try {
    const api = compile('lib/credit-token-estimates.ts', mocks);
    const pricing = await api.getTextTokenPricing();
    assert.equal(pricing.inputUsdPerToken, 0.0000003); assert.equal(pricing.outputUsdPerToken, 0.0000025);
    await api.getTextTokenPricing(); assert.equal(calls, 1);
    global.fetch = async () => Response.json({ data: [{ id: 'default', pricing: {} }] });
    await assert.rejects(compile('lib/credit-token-estimates.ts', mocks).getTextTokenPricing(), /token_pricing_unavailable/);
  } finally { global.fetch = original; }
});
