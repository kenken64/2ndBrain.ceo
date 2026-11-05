import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { lemonIntentProof, lemonWebhookConfig, validHexSignature, validWebhookSignature } from "@/lib/lemon-squeezy";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { publishTokenQuotaUpdate } from "@/lib/token-quota-redis";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const id = (value: unknown) => (typeof value === "string" && /^\d{1,30}$/.test(value)) || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ? String(value) : null;

export async function POST(request: Request) {
  const config = lemonWebhookConfig();
  if (!config || !hasSupabaseEnv() || !hasSupabaseServiceRoleEnv()) return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_000_000) return NextResponse.json({ error: "Request too large." }, { status: 413 });
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > 1_000_000) return NextResponse.json({ error: "Request too large." }, { status: 413 });
  if (!validWebhookSignature(raw, request.headers.get("x-signature") ?? "", config.secret)) return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  let payload: any; try { payload = JSON.parse(raw.toString("utf8")); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const event = payload?.meta?.event_name;
  if (event !== "order_created" && event !== "order_refunded") return NextResponse.json({ received: true });
  const intentId = payload?.meta?.custom_data?.intent_id, proof = payload?.meta?.custom_data?.proof;
  // A store may send other product orders to the same webhook.
  if (intentId == null) return NextResponse.json({ received: true });
  if (typeof intentId !== "string" || !UUID.test(intentId) || typeof proof !== "string" || !validHexSignature(lemonIntentProof(intentId, config.secret), proof)) {
    console.error("[lemon:webhook] invalid checkout proof");
    return NextResponse.json({ error: "Invalid checkout proof." }, { status: 400 });
  }
  const attrs = payload?.data?.attributes;
  const orderId = id(payload?.data?.id), storeId = id(attrs?.store_id), variantId = id(attrs?.first_order_item?.variant_id);
  const total = integer(attrs?.total_usd), subtotal = integer(attrs?.subtotal_usd), discount = integer(attrs?.discount_total_usd);
  const refunded = attrs?.refunded_amount_usd == null && attrs?.status === "paid" ? 0 : attrs?.refunded_amount_usd == null && attrs?.status === "refunded" ? total : integer(attrs?.refunded_amount_usd);
  const currency = attrs?.currency;
  const nativeTotal = integer(attrs?.total), nativeSubtotal = integer(attrs?.subtotal), nativeDiscount = integer(attrs?.discount_total);
  const nativeRefunded = attrs?.refunded_amount == null && attrs?.status === "paid" ? 0 : attrs?.refunded_amount == null && attrs?.status === "refunded" ? nativeTotal : integer(attrs?.refunded_amount);
  if (payload?.data?.type !== "orders" || !orderId || !storeId || !variantId || !["SGD", "USD"].includes(currency) || typeof attrs?.test_mode !== "boolean" || !["paid", "partial_refund", "refunded"].includes(attrs?.status) || total === null || subtotal === null || discount === null || refunded === null || nativeTotal === null || nativeSubtotal === null || nativeDiscount === null || nativeRefunded === null || (attrs.status === "paid" && (refunded !== 0 || nativeRefunded !== 0)) || (attrs.status === "refunded" && (refunded !== total || nativeRefunded !== nativeTotal)) || (attrs.status === "partial_refund" && (refunded >= total || nativeRefunded <= 0 || nativeRefunded >= nativeTotal))) {
    console.error("[lemon:webhook] invalid order payload", { orderId });
    return NextResponse.json({ error: "Invalid order payload." }, { status: 400 });
  }
  if (attrs.test_mode && !config.allowTestCredits) {
    console.warn("[lemon:webhook] test order ignored", { orderId });
    return NextResponse.json({ received: true });
  }
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("apply_lemon_credit_order_v2", {
    p_intent_id: intentId, p_order_id: orderId, p_store_id: storeId, p_variant_id: variantId, p_test_mode: attrs.test_mode,
    p_subtotal_usd: subtotal, p_discount_usd: discount, p_total_usd: total, p_refunded_usd: refunded,
    p_currency: currency, p_subtotal: nativeSubtotal, p_discount: nativeDiscount, p_total: nativeTotal, p_refunded: nativeRefunded
  }).single();
  if (error || !data) {
    console.error("[lemon:webhook] order not reconciled", { orderId, code: error?.code ?? "unknown" });
    return NextResponse.json({ error: "Order could not be reconciled." }, { status: 500 });
  }
  const result = data as { user_id: string; llm_token_quota: number | string; llm_token_used: number | string; delta_tokens: number | string };
  const delta = Number(result.delta_tokens);
  if (delta !== 0) {
    const { data: profile } = await admin.from("profiles").select("email,openclaw_instance").eq("id", result.user_id).maybeSingle();
    await publishTokenQuotaUpdate({ userId: result.user_id, email: profile?.email ?? null, openclawInstance: profile?.openclaw_instance ?? null, llmTokenQuota: Number(result.llm_token_quota), llmTokenUsed: Number(result.llm_token_used), deltaTokens: delta, reason: delta > 0 ? "lemon_credit_purchase" : "lemon_credit_refund", metadata: { orderId, intentId } });
  }
  return NextResponse.json({ received: true });
}
