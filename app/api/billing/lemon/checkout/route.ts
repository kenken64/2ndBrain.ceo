import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { createLemonCheckout, lemonConfig } from "@/lib/lemon-squeezy";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { resolveCreditOption } from "@/lib/credit-pricing-server";
import { SGD_TOPUP_CENTS } from "@/lib/credit-pricing";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const config = lemonConfig();
  if (!hasSupabaseEnv() || !hasSupabaseServiceRoleEnv() || !config || (config.testMode && !config.allowTestCredits)) return NextResponse.json({ error: "Card payments are not configured." }, { status: 503 });
  const origin = request.headers.get("origin"), host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host");
  if (!origin || !host || (() => { try { return new URL(origin).host !== host; } catch { return true; } })()) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);
  if (error || !userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { sgdCents?: unknown; expectedUsdCents?: unknown } | null;
  const sgdCents = body?.sgdCents;
  if (typeof sgdCents !== "number" || !SGD_TOPUP_CENTS.some(cents => cents === sgdCents) || !config.variantIds[sgdCents]) return NextResponse.json({ error: "Choose a valid top-up amount." }, { status: 400 });
  let selection: Awaited<ReturnType<typeof resolveCreditOption>>;
  try { selection = await resolveCreditOption(body?.sgdCents, body?.expectedUsdCents); }
  catch (reason) {
    const code = reason instanceof Error ? reason.message : "exchange_rates_unavailable";
    return NextResponse.json({ error: code === "credit_price_changed" ? "Exchange rates changed. Refresh your top-up options." : code === "invalid_credit_option" ? "Choose a valid top-up amount." : "Exchange rates are temporarily unavailable. Please try again." }, { status: code === "credit_price_changed" ? 409 : code === "invalid_credit_option" ? 400 : 503 });
  }
  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin.from("profiles").select("admin_disabled,admin_deleted_at").eq("id", userId).maybeSingle();
  if (profileError || !profile) return NextResponse.json({ error: "Unable to check your account." }, { status: 503 });
  if (profile.admin_disabled || profile.admin_deleted_at) return NextResponse.json({ error: "Account access is disabled." }, { status: 403 });
  const intentId = randomUUID();
  const { error: saveError } = await admin.from("lemon_credit_checkouts").insert({ id: intentId, user_id: userId, store_id: config.storeId, variant_id: config.variantIds[sgdCents], currency: "SGD", amount_cents: sgdCents, test_mode: config.testMode, package_tokens: selection.credits, usd_amount_cents: selection.usdCents });
  if (saveError) return NextResponse.json({ error: "Card checkout is temporarily unavailable." }, { status: 503 });
  try {
    const checkout = await createLemonCheckout(config, intentId, sgdCents);
    return NextResponse.json({ intentId, url: checkout.url }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (reason) {
    console.error("[lemon:checkout] unavailable", { reason: reason instanceof Error ? reason.message : "unknown" });
    return NextResponse.json({ error: "Card checkout is temporarily unavailable. Please try again later." }, { status: 503 });
  }
}
