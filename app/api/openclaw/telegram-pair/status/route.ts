import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TELEGRAM_PAIR_STALE_MS = 3 * 60 * 1000;

function optionalPositiveNumber(name: string, fallback: number) {
  const configured = Number(process.env[name] ?? "");

  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function nextAfterApproval(_next: string) {
  return "/dashboard/wiki";
}

function isStaleRunning(startedAt: string | null | undefined) {
  const staleMs = optionalPositiveNumber("OPENCLAW_TELEGRAM_PAIR_STALE_MS", DEFAULT_TELEGRAM_PAIR_STALE_MS);

  if (!startedAt) {
    return true;
  }

  const startedAtMs = Date.parse(startedAt);

  return !Number.isFinite(startedAtMs) || Date.now() - startedAtMs > staleMs;
}

export async function GET(request: Request) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next") ?? "/dashboard");
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(claimsData?.claims);

  if (claimsError || !userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(
      "onboarding_completed_at,openclaw_telegram_pair_completed_at,openclaw_telegram_pair_error,openclaw_telegram_pair_started_at,openclaw_telegram_pair_status"
    )
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const status = typeof profile?.openclaw_telegram_pair_status === "string"
    ? profile.openclaw_telegram_pair_status
    : null;
  const isReady = Boolean(
    status === "ready" &&
      profile?.openclaw_telegram_pair_completed_at &&
      profile?.onboarding_completed_at
  );

  if (isReady) {
    return NextResponse.json({
      canRetry: false,
      redirectTo: nextAfterApproval(next),
      status: "ready"
    });
  }

  if (status === "running" && isStaleRunning(profile?.openclaw_telegram_pair_started_at)) {
    const message = "Telegram approval timed out. Submit the approval code again.";

    await supabase
      .from("profiles")
      .update({
        openclaw_telegram_pair_error: message,
        openclaw_telegram_pair_status: "failed"
      })
      .eq("id", userId);

    return NextResponse.json({
      canRetry: true,
      message,
      status: "failed"
    });
  }

  return NextResponse.json({
    canRetry: status === "failed",
    message: profile?.openclaw_telegram_pair_error ?? null,
    status: status ?? "pending"
  });
}
