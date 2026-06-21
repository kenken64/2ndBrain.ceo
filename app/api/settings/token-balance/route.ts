import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(claimsData?.claims);

  if (claimsError || !userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("llm_token_quota,llm_token_used,openclaw_tokens_paused,openclaw_tokens_paused_at,openclaw_tokens_resumed_at,openclaw_tokens_pause_reason")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Profile was not found." }, { status: 404 });
  }

  const llmTokenQuota = Number(data.llm_token_quota ?? 0);
  const llmTokenUsed = Number(data.llm_token_used ?? 0);

  return NextResponse.json(
    {
      balance: {
        availableTokens: Math.max(0, llmTokenQuota - llmTokenUsed),
        llmTokenQuota,
        llmTokenUsed
      },
      pause: {
        openclawTokensPauseReason: data.openclaw_tokens_pause_reason ?? null,
        openclawTokensPaused: Boolean(data.openclaw_tokens_paused),
        openclawTokensPausedAt: data.openclaw_tokens_paused_at ?? null,
        openclawTokensResumedAt: data.openclaw_tokens_resumed_at ?? null
      }
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
