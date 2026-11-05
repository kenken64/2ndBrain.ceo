import "server-only";
import { CHAT_MODELS } from "@/lib/chat-models";
import type { TextTokenPricing } from "@/lib/ai-credit-rates";

let cached: { until: number; value: TextTokenPricing } | null = null;
/** Optional reference for the default text model; failure must not block top-ups. */
export async function getTextTokenPricing(): Promise<TextTokenPricing> {
  if (cached && cached.until > Date.now()) return cached.value;
  const model = CHAT_MODELS[0];
  const response = await fetch("https://openrouter.ai/api/v1/models", { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("token_pricing_unavailable");
  const body = await response.json();
  const pricing = Array.isArray(body?.data) ? body.data.find((item: { id?: string }) => item.id === model.id)?.pricing : null;
  const variants = pricing ? [pricing, ...(Array.isArray(pricing.overrides) ? pricing.overrides : [])] : [];
  const highest = (...keys: string[]) => Math.max(0, ...variants.flatMap(item => keys.map(key => {
    const value = Number(item[key]);
    return Number.isFinite(value) && value > 0 ? value : 0;
  })));
  const inputUsdPerToken = highest("prompt", "input_cache_write"), outputUsdPerToken = highest("completion");
  if (!inputUsdPerToken || !outputUsdPerToken) throw new Error("token_pricing_unavailable");
  const value = { modelLabel: model.label, inputUsdPerToken, outputUsdPerToken, checkedAt: new Date().toISOString() };
  cached = { until: Date.now() + 10 * 60_000, value };
  return value;
}
