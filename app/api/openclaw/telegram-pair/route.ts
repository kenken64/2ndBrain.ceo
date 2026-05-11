import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import {
  getUserIdFromClaims,
  onboardingPath,
  onboardingProfileSelect,
  type OnboardingProfile
} from "@/lib/onboarding";
import { pairOpenClawTelegram, setupOpenClawAvatar, setupOpenClawIdentity } from "@/lib/openclaw";
import { createClient } from "@/lib/supabase/server";
import { appUrl, safeNextPath } from "@/lib/url";

export const runtime = "nodejs";

function redirectToApproval(request: Request, next: string, error?: string) {
  const path = onboardingPath(next, "approval");
  const url = appUrl(path, request);

  if (error) {
    url.searchParams.set("error", error);
  }

  return NextResponse.redirect(url, { status: 303 });
}

function outputSummary(value: string) {
  return value.slice(-4000);
}

function pairErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (message.startsWith("missing_")) {
    return message;
  }

  return "openclaw_telegram_pair_failed";
}

function nextAfterApproval(_next: string) {
  return "/dashboard/wiki";
}

function sanitizeLogValue(value: string | null | undefined) {
  return (value ?? "")
    .replace(/[0-9]{6,}:[A-Za-z0-9_-]+/g, "[telegram_token]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[openai_key]")
    .replace(/AKIA[A-Z0-9]+/g, "[aws_access_key]")
    .replace(/(telegram-pair\s+--instance\s+\S+\s+--code\s+)[A-Za-z0-9]{6,}/g, "$1[telegram_pair_code]");
}

function logPair(event: string, details: Record<string, string | null | undefined>) {
  console.info(
    `[openclaw:telegram-pair] ${event}`,
    JSON.stringify(
      Object.fromEntries(
        Object.entries(details).map(([key, value]) => [key, sanitizeLogValue(value)])
      )
    )
  );
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
  const code = String(formData.get("telegramPairCode") ?? "").trim();

  if (!/^[a-zA-Z0-9]{8}$/.test(code)) {
    return redirectToApproval(request, next, "invalid_telegram_pair_code");
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(claimsData?.claims);

  if (claimsError || !userId) {
    return NextResponse.redirect(
      appUrl(`/login?next=${encodeURIComponent(onboardingPath(next, "approval"))}`, request),
      { status: 303 }
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(onboardingProfileSelect)
    .eq("id", userId)
    .maybeSingle();
  const onboardingProfile = profile as OnboardingProfile | null;
  const instance = onboardingProfile?.openclaw_instance?.trim();
  const avatarName = onboardingProfile?.avatar_name?.trim();
  const avatarGender = onboardingProfile?.avatar_gender?.trim();
  const avatarGlbPath = onboardingProfile?.avatar_glb_path?.trim();
  const ownerName = onboardingProfile?.owner_name?.trim();

  if (
    !instance ||
    onboardingProfile?.openclaw_provision_status !== "ready" ||
    !onboardingProfile.openclaw_provision_completed_at
  ) {
    return redirectToApproval(request, next, "openclaw_telegram_pair_required");
  }

  await supabase
    .from("profiles")
    .update({
      openclaw_telegram_pair_error: null,
      openclaw_telegram_pair_started_at: new Date().toISOString(),
      openclaw_telegram_pair_status: "running"
    })
    .eq("id", userId);

  try {
    const paired = await pairOpenClawTelegram({
      code,
      instance
    });

    const { error } = await supabase
      .from("profiles")
      .update({
        onboarding_completed_at: new Date().toISOString(),
        openclaw_telegram_pair_completed_at: new Date().toISOString(),
        openclaw_telegram_pair_error: null,
        openclaw_telegram_pair_output: outputSummary(paired.output),
        openclaw_telegram_pair_status: "ready"
      })
      .eq("id", userId);

    if (error) {
      return redirectToApproval(request, next, "save_failed");
    }

    const shouldSetupIdentity = Boolean(avatarName && ownerName && !onboardingProfile?.openclaw_identity_completed_at);
    const shouldSetupAvatar = Boolean(
      avatarName && avatarGender && avatarGlbPath && !onboardingProfile?.openclaw_remotion_completed_at
    );

    if (shouldSetupIdentity || shouldSetupAvatar) {
      void (async () => {
        if (shouldSetupIdentity && avatarName && ownerName) {
          try {
            const identitySetup = await setupOpenClawIdentity({
              avatarName,
              instance,
              ownerName
            });
            const backgroundSupabase = await createClient();

            await backgroundSupabase
              .from("profiles")
              .update({
                openclaw_identity_completed_at: new Date().toISOString(),
                openclaw_identity_error: null,
                openclaw_identity_output: outputSummary(identitySetup.identityOutput)
              })
              .eq("id", userId);

            logPair("identity_setup_ready", {
              instance,
              userId
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "openclaw_identity_setup_failed";
            const backgroundSupabase = await createClient();

            await backgroundSupabase
              .from("profiles")
              .update({
                openclaw_identity_error: message,
                openclaw_identity_output: outputSummary(`failed: ${message}`)
              })
              .eq("id", userId);

            logPair("identity_setup_failed", {
              instance,
              message,
              userId
            });
          }
        }

        if (shouldSetupAvatar && avatarName && avatarGender && avatarGlbPath) {
          try {
            const avatarSetup = await setupOpenClawAvatar({
              avatarGender,
              avatarGlbPath,
              avatarName,
              instance
            });
            const completedAt = new Date().toISOString();
            const backgroundSupabase = await createClient();

            await backgroundSupabase
              .from("profiles")
              .update({
                openclaw_remotion_completed_at: completedAt,
                openclaw_remotion_output: outputSummary(avatarSetup.remotionOutput),
                openclaw_remotion_url: avatarSetup.remotionUrl
              })
              .eq("id", userId);

            logPair("avatar_setup_ready", {
              instance,
              userId
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "openclaw_avatar_setup_failed";
            const backgroundSupabase = await createClient();

            await backgroundSupabase
              .from("profiles")
              .update({
                openclaw_remotion_output: outputSummary(`failed: ${message}`)
              })
              .eq("id", userId);

            logPair("avatar_setup_failed", {
              instance,
              message,
              userId
            });
          }
        }
      })();
    }

    return NextResponse.redirect(appUrl(nextAfterApproval(next), request), { status: 303 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "openclaw_telegram_pair_failed";

    await supabase
      .from("profiles")
      .update({
        openclaw_telegram_pair_error: message,
        openclaw_telegram_pair_status: "failed"
      })
      .eq("id", userId);

    return redirectToApproval(request, next, pairErrorCode(error));
  }
}
