import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims, onboardingPath } from "@/lib/onboarding";
import { setupOpenClawTelegramBot } from "@/lib/openclaw";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/url";

export const runtime = "nodejs";

function outputSummary(value: string) {
  return value.slice(-4000);
}

function sanitizeLogValue(value: string | null | undefined) {
  return (value ?? "").replace(/[0-9]{6,}:[A-Za-z0-9_-]+/g, "[telegram_token]");
}

function logTelegramToken(event: string, details: Record<string, string | null | undefined>) {
  console.info(
    `[openclaw:telegram-token] ${event}`,
    JSON.stringify(
      Object.fromEntries(
        Object.entries(details).map(([key, value]) => [key, sanitizeLogValue(value)])
      )
    )
  );
}

function validateTelegramBotToken(value: string) {
  if (!value) {
    return "Telegram bot token is required.";
  }

  if (value.length > 256) {
    return "Telegram bot token is too long.";
  }

  if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(value)) {
    return "Enter a valid Telegram bot token.";
  }

  return null;
}

export async function POST(request: Request) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const formData = await request.formData();
  const telegramBotToken = String(formData.get("telegramBotToken") ?? "").trim();
  const next = safeNextPath(String(formData.get("next") ?? "/dashboard"));
  const validationError = validateTelegramBotToken(telegramBotToken);

  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(claimsData?.claims);

  if (claimsError || !userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("openclaw_instance,openclaw_provision_status,openclaw_provision_completed_at")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const instance = typeof profile?.openclaw_instance === "string" ? profile.openclaw_instance.trim() : "";

  if (!instance || profile?.openclaw_provision_status !== "ready" || !profile.openclaw_provision_completed_at) {
    return NextResponse.json({ error: "OpenClaw must be provisioned before changing Telegram bot token." }, { status: 409 });
  }

  logTelegramToken("start", {
    instance,
    userId
  });

  try {
    const configured = await setupOpenClawTelegramBot({
      instance,
      telegramBotToken
    });

    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        onboarding_completed_at: null,
        openclaw_telegram_output: outputSummary(configured.output),
        openclaw_telegram_pair_completed_at: null,
        openclaw_telegram_pair_error: null,
        openclaw_telegram_pair_output: null,
        openclaw_telegram_pair_started_at: null,
        openclaw_telegram_pair_status: "pending",
        telegram_bot_token: telegramBotToken
      })
      .eq("id", userId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    logTelegramToken("ready", {
      instance,
      userId
    });

    return NextResponse.json({
      ok: true,
      redirectTo: onboardingPath(next, "approval")
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "openclaw_telegram_setup_failed";

    logTelegramToken("failed", {
      instance,
      message,
      userId
    });

    await supabase
      .from("profiles")
      .update({
        openclaw_telegram_pair_error: outputSummary(message),
        openclaw_telegram_pair_status: "failed"
      })
      .eq("id", userId);

    return NextResponse.json({ error: outputSummary(message) }, { status: 500 });
  }
}
