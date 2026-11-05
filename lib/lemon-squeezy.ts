import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { SGD_TOPUP_CENTS } from "@/lib/credit-pricing";

type Config = { apiKey: string; storeId: string; variantIds: Record<number, string>; webhookSecret: string; testMode: boolean; allowTestCredits: boolean };
const clean = (value: string | undefined) => value?.trim().replace(/^['"]|['"]$/g, "") ?? "";
export function lemonConfig(): Config | null {
  const apiKey = clean(process.env.LEMONSQUEEZY_API_KEY);
  const storeId = clean(process.env.LEMONSQUEEZY_STORE_ID);
  const variantIds = Object.fromEntries(SGD_TOPUP_CENTS.map(cents => [cents, clean(process.env[`LEMONSQUEEZY_VARIANT_ID_SGD_${cents / 100}`])]));
  const webhookSecret = clean(process.env.LEMONSQUEEZY_WEBHOOK_SECRET);
  const mode = clean(process.env.LEMONSQUEEZY_TEST_MODE);
  if (!apiKey || !/^\d{1,20}$/.test(storeId) || !Object.values(variantIds).every(value => /^\d{1,20}$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0) || new Set(Object.values(variantIds)).size !== SGD_TOPUP_CENTS.length || webhookSecret.length < 6 || webhookSecret.length > 40 || !["true", "false"].includes(mode)) return null;
  return { apiKey, storeId, variantIds, webhookSecret, testMode: mode === "true", allowTestCredits: clean(process.env.LEMONSQUEEZY_ALLOW_TEST_CREDITS) === "true" };
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
export async function createLemonCheckout(config: Config, intentId: string, sgdCents: number) {
  const variantId = config.variantIds[sgdCents];
  if (!SGD_TOPUP_CENTS.some(cents => cents === sgdCents) || !variantId) throw new Error("lemon_product_mismatch");
  const [store, variant, prices] = await Promise.all([
    lemonApi(config, `/stores/${config.storeId}`), lemonApi(config, `/variants/${variantId}`),
    lemonApi(config, `/prices?filter%5Bvariant_id%5D=${variantId}&page%5Bsize%5D=1`)
  ]);
  const sa = store.data?.attributes, va = variant.data?.attributes, pa = Array.isArray(prices.data) ? prices.data[0]?.attributes : null;
  if (String(store.data?.id) !== config.storeId || sa?.currency !== "SGD" || String(variant.data?.id) !== variantId || va?.test_mode !== config.testMode || !["published", "pending"].includes(va?.status) || !Number.isSafeInteger(va?.product_id) ||
      !pa || String(pa.variant_id) !== variantId || pa.category !== "one_time" || pa.scheme !== "standard" || pa.unit_price !== sgdCents) throw new Error("lemon_product_mismatch");
  const product = await lemonApi(config, `/products/${va.product_id}`);
  if (String(product.data?.attributes?.store_id) !== config.storeId || product.data?.attributes?.test_mode !== config.testMode || product.data?.attributes?.status !== "published" || product.data?.attributes?.pay_what_you_want !== false) throw new Error("lemon_product_mismatch");
  const checkout = await lemonApi(config, "/checkouts", { method: "POST", body: JSON.stringify({ data: { type: "checkouts", attributes: {
    checkout_options: { embed: true, discount: false }, product_options: { enabled_variants: [Number(variantId)] },
    checkout_data: { custom: { intent_id: intentId, proof: lemonIntentProof(intentId, config.webhookSecret) }, variant_quantities: [{ variant_id: Number(variantId), quantity: 1 }] },
    test_mode: config.testMode, expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
  }, relationships: { store: { data: { type: "stores", id: config.storeId } }, variant: { data: { type: "variants", id: variantId } } } } }) });
  if (checkout.data?.attributes?.custom_price != null || String(checkout.data?.attributes?.store_id) !== config.storeId || String(checkout.data?.attributes?.variant_id) !== variantId || checkout.data?.attributes?.test_mode !== config.testMode) throw new Error("lemon_checkout_invalid");
  const url = checkout.data?.attributes?.url;
  let parsed: URL; try { parsed = new URL(url); } catch { throw new Error("lemon_checkout_invalid"); }
  // Only the official Lemon Squeezy hosted checkout can receive a customer.
  if (parsed.protocol !== "https:" || !(parsed.hostname === "lemonsqueezy.com" || parsed.hostname.endsWith(".lemonsqueezy.com") || (typeof sa?.domain === "string" && parsed.hostname === sa.domain.toLowerCase())) || !parsed.pathname.startsWith("/checkout/")) throw new Error("lemon_checkout_invalid");
  return { url: parsed.toString() };
}
