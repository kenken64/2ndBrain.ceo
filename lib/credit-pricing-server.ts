import "server-only";
import { buildCreditOptions, type CreditOption, type CreditOptions } from "@/lib/credit-pricing";
import { AI_CREDIT_PACKAGE_TOKENS, AI_CREDIT_PACKAGE_USD_CENTS } from "@/lib/solana-billing";
let cached: { until: number; value: CreditOptions } | null = null;
/** Daily ECB reference rates; fail closed if data is unavailable or stale. */
export async function getCreditOptions(): Promise<CreditOptions> {
  if (cached && cached.until > Date.now()) return cached.value;
  const response = await fetch("https://api.frankfurter.dev/v2/rates?base=SGD&quotes=USD%2CCNY&providers=ECB", { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("exchange_rates_unavailable");
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error("exchange_rates_unavailable");
  const usd = data.find(item => item?.base === "SGD" && item?.quote === "USD");
  const cny = data.find(item => item?.base === "SGD" && item?.quote === "CNY");
  const published = typeof usd?.date === "string" ? Date.parse(`${usd.date}T00:00:00Z`) : NaN;
  if (!usd || !cny || usd.date !== cny.date || !Number.isFinite(published) || published > Date.now() + 86_400_000 || Date.now() - published > 5 * 86_400_000 || typeof usd.rate !== "number" || usd.rate < 0.1 || usd.rate > 10 || typeof cny.rate !== "number" || cny.rate < 0.1 || cny.rate > 100) throw new Error("exchange_rates_unavailable");
  const value = buildCreditOptions(usd.rate, cny.rate, usd.date);
  cached = { value, until: Date.now() + 10 * 60_000 };
  return value;
}
/** Legacy callers without a selected amount retain the former $30 package. */
export async function resolveCreditOption(sgdCents: unknown, expectedUsdCents: unknown): Promise<Pick<CreditOption, "usdCents" | "credits">> {
  if (sgdCents == null && expectedUsdCents == null) return { usdCents: AI_CREDIT_PACKAGE_USD_CENTS, credits: AI_CREDIT_PACKAGE_TOKENS };
  if (!Number.isSafeInteger(sgdCents) || !Number.isSafeInteger(expectedUsdCents)) throw new Error("invalid_credit_option");
  const selection = (await getCreditOptions()).options.find(option => option.sgdCents === sgdCents);
  if (!selection) throw new Error("invalid_credit_option");
  if (selection.usdCents !== expectedUsdCents) throw new Error("credit_price_changed");
  return selection;
}
