import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import {
  getUserIdFromClaims,
  onboardingPath,
  onboardingProfileSelect,
  type OnboardingProfile
} from "@/lib/onboarding";
import { provisionOpenClaw } from "@/lib/openclaw";
import { createClient } from "@/lib/supabase/server";
import { appUrl, safeNextPath } from "@/lib/url";

export const runtime = "nodejs";

const STALE_PROVISION_MS = 30 * 60 * 1000;

function redirectToProvision(request: Request, next: string, error?: string) {
  const path = onboardingPath(next, "provision");
  const url = appUrl(path, request);

  if (error) {
    url.searchParams.set("error", error);
  }

  return NextResponse.redirect(url, { status: 303 });
}

function outputSummary(value: string) {
  return value.slice(-4000);
}

function sanitizeLogValue(value: string | null | undefined) {
  return (value ?? "")
    .replace(/[0-9]{6,}:[A-Za-z0-9_-]+/g, "[telegram_token]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[openai_key]")
    .replace(/AKIA[A-Z0-9]+/g, "[aws_access_key]");
}

function logProvision(event: string, details: Record<string, string | null | undefined>) {
  console.info(
    `[openclaw:provision] ${event}`,
    JSON.stringify(
      Object.fromEntries(
        Object.entries(details).map(([key, value]) => [key, sanitizeLogValue(value)])
      )
    )
  );
}

function provisionErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const lowerMessage = message.toLowerCase();

  if (message.startsWith("missing_")) {
    return message;
  }

  if (lowerMessage.includes("snapshot not found")) {
    return "openclaw_snapshot_not_found";
  }

  if (lowerMessage.includes("failed to parse snapshot response")) {
    return "openclaw_snapshot_response_failed";
  }

  if (message === "openclaw_instance_not_found") {
    return message;
  }

  return "openclaw_provision_failed";
}

function nextAfterProvision(next: string) {
  return onboardingPath(next, "approval");
}

function isStaleProvision(profile: OnboardingProfile | null) {
  if (profile?.openclaw_provision_status !== "running") {
    return false;
  }

  const startedAt = profile.openclaw_provision_started_at
    ? Date.parse(profile.openclaw_provision_started_at)
    : Number.NaN;

  return !Number.isFinite(startedAt) || Date.now() - startedAt > STALE_PROVISION_MS;
}

export async function POST(request: Request) {
  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(
      appUrl("/login?error=supabase_config&next=/onboarding", request),
      { status: 303 }
    );
  }

  const formData = await request.formData();
  const next = safeNextPath(String(formData.get("next") ?? "/dashboard"));
  logProvision("request", { next });
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(claimsData?.claims);

  if (claimsError || !userId) {
    return NextResponse.redirect(
      appUrl(`/login?next=${encodeURIComponent(onboardingPath(next, "provision"))}`, request),
      { status: 303 }
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(onboardingProfileSelect)
    .eq("id", userId)
    .maybeSingle();
  const onboardingProfile = profile as OnboardingProfile | null;
  const ownerName = onboardingProfile?.owner_name?.trim();
  const avatarName = onboardingProfile?.avatar_name?.trim();
  const avatarGender = onboardingProfile?.avatar_gender?.trim();
  const telegramBotToken = onboardingProfile?.telegram_bot_token?.trim();
  const existingInstance = onboardingProfile?.openclaw_instance?.trim();

  if (
    !ownerName ||
    !avatarName ||
    !avatarGender ||
    !telegramBotToken ||
    !onboardingProfile?.avatar_glb_path?.trim() ||
    !onboardingProfile.avatar_completed_at
  ) {
    return redirectToProvision(request, next, "missing_fields");
  }

  if (
    onboardingProfile?.openclaw_provision_status === "ready" &&
    existingInstance &&
    onboardingProfile.openclaw_provision_completed_at
  ) {
    return NextResponse.redirect(appUrl(nextAfterProvision(next), request), { status: 303 });
  }

  if (isStaleProvision(onboardingProfile)) {
    logProvision("stale_lock_reset", {
      startedAt: onboardingProfile?.openclaw_provision_started_at,
      userId
    });

    await supabase
      .from("profiles")
      .update({
        openclaw_provision_error: "Provisioning request timed out before completion.",
        openclaw_provision_status: "failed"
      })
      .eq("id", userId)
      .eq("openclaw_provision_status", "running");
  } else if (onboardingProfile?.openclaw_provision_status === "running") {
    logProvision("duplicate_rejected", {
      reason: "profile_status_running",
      userId
    });
    return redirectToProvision(request, next, "openclaw_provision_running");
  }

  const { data: lock, error: lockError } = await supabase
    .from("profiles")
    .update({
      openclaw_provision_error: null,
      openclaw_provision_started_at: new Date().toISOString(),
      openclaw_provision_status: "running"
    })
    .eq("id", userId)
    .or("openclaw_provision_status.is.null,openclaw_provision_status.neq.running")
    .select("id")
    .maybeSingle();

  if (lockError) {
    return redirectToProvision(request, next, "save_failed");
  }

  if (!lock) {
    logProvision("duplicate_rejected", {
      reason: "lock_not_acquired",
      userId
    });
    return redirectToProvision(request, next, "openclaw_provision_running");
  }

  logProvision("lock_acquired", {
    existingInstance,
    userId
  });

  try {
    logProvision("start", {
      avatarGlbPath: onboardingProfile.avatar_glb_path,
      avatarName,
      existingInstance,
      ownerName,
      userId
    });

    const provisioned = await provisionOpenClaw({
      avatarGender,
      avatarName,
      existingInstance,
      onInstanceRestored: async (details) => {
        await supabase
          .from("profiles")
          .update({
            openclaw_instance: details.instance,
            openclaw_provision_output: outputSummary(details.restoreOutput),
            openclaw_region: details.region,
            openclaw_snapshot_name: details.snapshotName
          })
          .eq("id", userId);
      },
      ownerName,
      telegramBotToken
    });
    const completedAt = new Date().toISOString();

    const { error } = await supabase
      .from("profiles")
      .update({
        openclaw_identity_completed_at: completedAt,
        openclaw_identity_error: null,
        openclaw_identity_output: outputSummary(provisioned.restoreOutput),
        openclaw_instance: provisioned.instance,
        openclaw_provision_completed_at: completedAt,
        openclaw_provision_error: null,
        openclaw_provision_output: outputSummary(provisioned.restoreOutput),
        openclaw_provision_status: "ready",
        openclaw_region: provisioned.region,
        openclaw_snapshot_name: provisioned.snapshotName,
        openclaw_telegram_pair_error: null,
        openclaw_telegram_pair_status: "pending",
        openclaw_telegram_output: outputSummary(provisioned.restoreOutput),
        onboarding_completed_at: null
      })
      .eq("id", userId);

    if (error) {
      logProvision("save_failed", {
        instance: provisioned.instance,
        userId
      });
      return redirectToProvision(request, next, "save_failed");
    }

    logProvision("ready", {
      instance: provisioned.instance,
      region: provisioned.region,
      userId
    });

    return NextResponse.redirect(appUrl(nextAfterProvision(next), request), { status: 303 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "openclaw_provision_failed";
    const code = provisionErrorCode(error);

    logProvision("failed", {
      code,
      message,
      userId
    });

    await supabase
      .from("profiles")
      .update({
        openclaw_provision_error: message,
        openclaw_provision_status: "failed"
      })
      .eq("id", userId);

    return redirectToProvision(request, next, code);
  }
}
