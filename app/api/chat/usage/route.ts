import { NextResponse } from "next/server";
import { isAdminUser } from "@/lib/admin";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PAGE_SIZE = 20;
export async function GET(request: Request) {
  if (!hasSupabaseEnv()) return NextResponse.json({ error: "Usage is not configured." }, { status: 503 });
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);
  if (error || !userId) return NextResponse.json({ error: "Please log in to view usage." }, { status: 401 });
  const rawPage = new URL(request.url).searchParams.get("page") ?? "1";
  if (!/^[1-9]\d{0,3}$/.test(rawPage)) return NextResponse.json({ error: "Invalid page." }, { status: 400 });
  const page = Number(rawPage);
  const [summary, items, profile, quotaExempt] = await Promise.all([
    supabase.rpc("current_user_chat_usage_summary"),
    supabase.from("chat_credit_requests")
      .select("id,created_at,model_id,request_kind,pdf_pages,prompt_tokens,completion_tokens,cost_usd,reserved_credits,charged_credits,quota_exempt,status")
      .eq("user_id", userId).order("created_at", { ascending: false }).order("id", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    supabase.from("profiles").select("llm_token_quota,llm_token_used").eq("id", userId).maybeSingle(),
    isAdminUser(typeof data?.claims?.email === "string" ? data.claims.email : null, userId)
  ]);
  if (summary.error || items.error || profile.error || !profile.data) {
    console.error("[chat:usage] Could not load usage", summary.error?.message, items.error?.message, profile.error?.message);
    return NextResponse.json({ error: "Usage could not be loaded. Please try again." }, { status: 503 });
  }
  return NextResponse.json({ summary: summary.data ?? [], items: (items.data ?? []).slice(0, PAGE_SIZE), hasMore: (items.data?.length ?? 0) > PAGE_SIZE, page,
    quotaExempt, availableCredits: Math.max(0, Number(profile.data.llm_token_quota ?? 0) - Number(profile.data.llm_token_used ?? 0)) },
    { headers: { "Cache-Control": "no-store" } });
}
