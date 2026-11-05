/** Purchase value and usage pricing are separate: usage includes the service markup. */
export const AI_CREDITS_PER_USD = 250_000;
export const OPENROUTER_MARKUP_PERCENT = 20;
export const OPENROUTER_CREDITS_PER_USD = AI_CREDITS_PER_USD * (100 + OPENROUTER_MARKUP_PERCENT) / 100;

export function openRouterCostToCredits(costUsd: number): number {
  if (!Number.isFinite(costUsd) || costUsd < 0) throw new Error("invalid_provider_cost");
  const credits = Math.ceil(costUsd * OPENROUTER_CREDITS_PER_USD);
  if (!Number.isSafeInteger(credits)) throw new Error("invalid_provider_cost");
  return credits;
}

export type TextTokenPricing = { modelLabel: string; inputUsdPerToken: number; outputUsdPerToken: number; checkedAt: string };
export function estimateTextTokens(credits: number, pricing: TextTokenPricing) {
  const providerBudget = credits / OPENROUTER_CREDITS_PER_USD;
  return {
    inputOnly: Math.floor(providerBudget / pricing.inputUsdPerToken),
    outputOnly: Math.floor(providerBudget / pricing.outputUsdPerToken)
  };
}
