import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export async function GET() {
  if (!hasSupabaseEnv() || !hasSupabaseServiceRoleEnv()) return NextResponse.json({ error: "Card payment history is unavailable." }, { status: 503 });
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);
  if (error || !userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const admin = createAdminClient();
  const { data: rows, error: lookupError } = await admin.from("lemon_credit_checkouts")
    .select("id,order_id,status,credited_tokens,package_tokens,currency,total_currency_cents,total_usd_cents,refunded_usd_cents,test_mode,created_at")
    .eq("user_id", userId).not("order_id", "is", null).order("created_at", { ascending: false }).limit(25);
  if (lookupError) return NextResponse.json({ error: "Card payment history is unavailable." }, { status: 503 });
  return NextResponse.json({ payments: rows ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
}
