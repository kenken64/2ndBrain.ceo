import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  if (!hasSupabaseEnv() || !hasSupabaseServiceRoleEnv()) return NextResponse.json({ error: "Card payment status is unavailable." }, { status: 503 });
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);
  if (error || !userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const intentId = new URL(request.url).searchParams.get("intent");
  if (!intentId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intentId)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const admin = createAdminClient();
  const [{ data: intent, error: intentError }, { data: profile, error: profileError }] = await Promise.all([
    admin.from("lemon_credit_checkouts").select("status,credited_tokens").eq("id", intentId).eq("user_id", userId).maybeSingle(),
    admin.from("profiles").select("llm_token_quota,llm_token_used,admin_disabled,admin_deleted_at").eq("id", userId).maybeSingle()
  ]);
  if (intentError || profileError) return NextResponse.json({ error: "Card payment status is unavailable." }, { status: 503 });
  if (!profile || profile.admin_disabled || profile.admin_deleted_at) return NextResponse.json({ error: "Account access is disabled." }, { status: 403 });
  if (!intent) return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  return NextResponse.json({ status: intent.status, creditedTokens: Number(intent.credited_tokens), balance: { quota: Number(profile.llm_token_quota), used: Number(profile.llm_token_used) } }, { headers: { "Cache-Control": "private, no-store" } });
}
