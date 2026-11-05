const { test } = require('node:test');
const assert = require('node:assert/strict');
const rates = require('./helpers/load-credit-rates.cjs');

test('confirmed provider usage includes the agreed markup once and preserves free usage', () => {
  assert.equal(rates.AI_CREDITS_PER_USD, 250000);
  assert.equal(rates.openRouterCostToCredits(1), 300000);
  assert.equal(rates.openRouterCostToCredits(0.001), 300);
  assert.equal(rates.openRouterCostToCredits(0.032), 9600);
  assert.equal(rates.openRouterCostToCredits(0.000001), 1);
  assert.equal(rates.openRouterCostToCredits(0), 0);
  for (const value of [-1, Infinity, NaN]) assert.throws(() => rates.openRouterCostToCredits(value), /invalid_provider_cost/);
});

test('text-token reference spends the purchased credits at the final usage rate', () => {
  const pricing = { modelLabel: 'Reference', inputUsdPerToken: 0.0000003, outputUsdPerToken: 0.0000025, checkedAt: '2026-11-05T00:00:00Z' };
  const result = rates.estimateTextTokens(977500, pricing);
  assert.equal(result.inputOnly, 10861111);
  assert.equal(result.outputOnly, 1303333);
  assert.deepEqual(rates.estimateTextTokens(0, pricing), { inputOnly: 0, outputOnly: 0 });
});
