const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function compile(file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', file);
  const instance = new Module(filename, module); instance.filename = filename; instance.paths = module.paths;
  const original = Module._load;
  try {
    Module._load = function(request, ...args) { return Object.hasOwn(mocks, request) ? mocks[request] : original.call(this, request, ...args); };
    instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  } finally { Module._load = original; }
  return instance.exports;
}
const pricing = compile('lib/credit-pricing.ts');
function server() { return compile('lib/credit-pricing-server.ts', { 'server-only': {}, '@/lib/credit-pricing': pricing, '@/lib/solana-billing': { AI_CREDIT_PACKAGE_USD_CENTS: 3000, AI_CREDIT_PACKAGE_TOKENS: 7500000 } }); }
function rates(date) { return [{ date, base: 'SGD', quote: 'USD', rate: 0.78254 }, { date, base: 'SGD', quote: 'CNY', rate: 5.2214 }]; }
test('six SGD choices preserve the USD credit rate and reject altered or stale selections', async () => {
  const original = global.fetch; let calls = 0;
  global.fetch = async () => { calls++; return Response.json(rates(new Date().toISOString().slice(0, 10))); };
  try {
    const api = server(); const result = await api.getCreditOptions();
    assert.deepEqual(result.options.map(x => x.sgdCents), [500, 1000, 2000, 3000, 5000, 10000]);
    assert.deepEqual(result.options[0], { sgdCents: 500, cnyCents: 2611, usdCents: 391, credits: 977500 });
    assert.equal((await api.resolveCreditOption(500, 391)).credits, 977500);
    await assert.rejects(api.resolveCreditOption(500, 1), /credit_price_changed/);
    await assert.rejects(api.resolveCreditOption(501, 391), /invalid_credit_option/);
    await assert.rejects(api.resolveCreditOption(500, undefined), /invalid_credit_option/);
    assert.deepEqual(await api.resolveCreditOption(undefined, undefined), { usdCents: 3000, credits: 7500000 });
    assert.equal(calls, 1);
  } finally { global.fetch = original; }
});
test('unavailable, inconsistent and stale exchange rates fail closed', async () => {
  const original = global.fetch;
  try {
    for (const value of [[], rates('2020-01-01'), [rates(new Date().toISOString().slice(0, 10))[0]]]) {
      global.fetch = async () => Response.json(value);
      await assert.rejects(server().getCreditOptions(), /exchange_rates_unavailable/);
    }
    global.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(server().getCreditOptions(), /exchange_rates_unavailable/);
  } finally { global.fetch = original; }
});
