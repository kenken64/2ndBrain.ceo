import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { AI_CREDIT_PACKAGE_USD_CENTS } from "@/lib/solana-billing";

type Config = { apiKey: string; storeId: string; variantId: string; webhookSecret: string; testMode: boolean; allowTestCredits: boolean };
const clean = (value: string | undefined) => value?.trim().replace(/^['"]|['"]$/g, "") ?? "";
export function lemonConfig(): Config | null {
  const apiKey = clean(process.env.LEMONSQUEEZY_API_KEY);
  const storeId = clean(process.env.LEMONSQUEEZY_STORE_ID);
  const variantId = clean(process.env.LEMONSQUEEZY_VARIANT_ID);
  const webhookSecret = clean(process.env.LEMONSQUEEZY_WEBHOOK_SECRET);
  const mode = clean(process.env.LEMONSQUEEZY_TEST_MODE);
  if (!apiKey || !/^\d{1,20}$/.test(storeId) || !/^\d{1,20}$/.test(variantId) || !Number.isSafeInteger(Number(variantId)) || webhookSecret.length < 6 || webhookSecret.length > 40 || !["true", "false"].includes(mode)) return null;
  return { apiKey, storeId, variantId, webhookSecret, testMode: mode === "true", allowTestCredits: clean(process.env.LEMONSQUEEZY_ALLOW_TEST_CREDITS) === "true" };
}
export function hasLemonBillingEnv() { const config = lemonConfig(); return Boolean(config && (!config.testMode || config.allowTestCredits)); }
export function lemonWebhookConfig() {
  const secret = clean(process.env.LEMONSQUEEZY_WEBHOOK_SECRET);
  if (secret.length < 6 || secret.length > 40) return null;
  return { secret, allowTestCredits: clean(process.env.LEMONSQUEEZY_ALLOW_TEST_CREDITS) === "true" };
}
export function lemonIntentProof(intentId: string, secret: string) { return createHmac("sha256", secret).update(`ai-credit-checkout:${intentId}`).digest("hex"); }
export function validHexSignature(expected: string, actual: string) {
  if (!/^[0-9a-f]{64}$/i.test(actual) || !/^[0-9a-f]{64}$/i.test(expected)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}
export function validWebhookSignature(raw: Buffer, header: string, secret: string) {
  return validHexSignature(createHmac("sha256", secret).update(raw).digest("hex"), header);
}
async function lemonApi(config: Config, pathname: string, options: RequestInit = {}) {
  const response = await fetch(`https://api.lemonsqueezy.com/v1${pathname}`, {
    ...options, headers: { Accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json", Authorization: `Bearer ${config.apiKey}` }, cache: "no-store", signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error("lemon_api_unavailable");
  return await response.json() as { data?: any; links?: { next?: string | null } };
}
/** Refuse subscriptions, variable prices, wrong stores and incorrect currencies before a customer pays. */
export async function createLemonCheckout(config: Config, intentId: string, usdCents = AI_CREDIT_PACKAGE_USD_CENTS) {
  if (!Number.isSafeInteger(usdCents) || usdCents <= 0) throw new Error("lemon_product_mismatch");
  const [store, variant, prices] = await Promise.all([
    lemonApi(config, `/stores/${config.storeId}`), lemonApi(config, `/variants/${config.variantId}`),
    lemonApi(config, `/prices?filter%5Bvariant_id%5D=${config.variantId}&page%5Bsize%5D=1`)
  ]);
  const sa = store.data?.attributes, va = variant.data?.attributes, pa = Array.isArray(prices.data) ? prices.data[0]?.attributes : null;
  if (String(store.data?.id) !== config.storeId || sa?.currency !== "USD" || String(variant.data?.id) !== config.variantId || va?.test_mode !== config.testMode || !["published", "pending"].includes(va?.status) || !Number.isSafeInteger(va?.product_id) ||
      !pa || String(pa.variant_id) !== config.variantId || pa.category !== "one_time" || pa.scheme !== "standard" || pa.unit_price !== AI_CREDIT_PACKAGE_USD_CENTS) throw new Error("lemon_product_mismatch");
  const product = await lemonApi(config, `/products/${va.product_id}`);
  if (String(product.data?.attributes?.store_id) !== config.storeId || product.data?.attributes?.test_mode !== config.testMode || product.data?.attributes?.status !== "published" || product.data?.attributes?.pay_what_you_want !== false) throw new Error("lemon_product_mismatch");
  const checkout = await lemonApi(config, "/checkouts", { method: "POST", body: JSON.stringify({ data: { type: "checkouts", attributes: {
    custom_price: usdCents, checkout_options: { embed: true, discount: false }, product_options: { enabled_variants: [Number(config.variantId)] },
    checkout_data: { custom: { intent_id: intentId, proof: lemonIntentProof(intentId, config.webhookSecret) }, variant_quantities: [{ variant_id: Number(config.variantId), quantity: 1 }] },
    test_mode: config.testMode, expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
  }, relationships: { store: { data: { type: "stores", id: config.storeId } }, variant: { data: { type: "variants", id: config.variantId } } } } }) });
  if (checkout.data?.attributes?.custom_price !== usdCents || String(checkout.data?.attributes?.store_id) !== config.storeId || String(checkout.data?.attributes?.variant_id) !== config.variantId || checkout.data?.attributes?.test_mode !== config.testMode) throw new Error("lemon_checkout_invalid");
  const url = checkout.data?.attributes?.url;
  let parsed: URL; try { parsed = new URL(url); } catch { throw new Error("lemon_checkout_invalid"); }
  // Only the official Lemon Squeezy hosted checkout can receive a customer.
  if (parsed.protocol !== "https:" || !(parsed.hostname === "lemonsqueezy.com" || parsed.hostname.endsWith(".lemonsqueezy.com") || (typeof sa?.domain === "string" && parsed.hostname === sa.domain.toLowerCase())) || !parsed.pathname.startsWith("/checkout/")) throw new Error("lemon_checkout_invalid");
  return { url: parsed.toString(), packageTokens: usdCents * 2500, usdAmountCents: usdCents };
}
