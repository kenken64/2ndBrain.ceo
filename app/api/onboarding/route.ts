import { NextResponse } from "next/server";
import { downloadAvaturnGlb, storeUploadedAvaturnGlb } from "@/lib/avaturn";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims, onboardingPath, onboardingProfileSelect, parseOnboardingStep, type OnboardingProfile } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { appUrl, safeNextPath } from "@/lib/url";

export const runtime = "nodejs";

function onboardingRedirect(request: Request, error: string, next: string, step = "enrolment") {
  return NextResponse.redirect(
    appUrl(
      `/onboarding?step=${encodeURIComponent(step)}&error=${error}&next=${encodeURIComponent(next)}`,
      request
    ),
    { status: 303 }
  );
}

function parseJsonObject(value: string) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function" &&
    "size" in value &&
    typeof value.size === "number" &&
    value.size > 0
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
  const next = safeNextPath(String(formData.get("next") ?? "/dashboard/chat"));
  const step = parseOnboardingStep(String(formData.get("step") ?? "enrolment")) ?? "enrolment";

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = getUserIdFromClaims(claims);

  if (claimsError || !userId) {
    return NextResponse.redirect(
      appUrl(`/login?next=${encodeURIComponent(onboardingPath(next, step))}`, request),
      { status: 303 }
    );
  }

  const email = typeof claims?.email === "string" ? claims.email : null;

  if (step === "enrolment") {
    const ownerName = String(formData.get("ownerName") ?? "").trim();
    const avatarName = String(formData.get("avatarName") ?? "").trim();
    const avatarGender = String(formData.get("avatarGender") ?? "").trim();
    const telegramBotToken = String(formData.get("telegramBotToken") ?? "").trim();

    if (!ownerName || !avatarName || !avatarGender) {
      return onboardingRedirect(request, "missing_fields", next, "enrolment");
    }

    if (ownerName.length > 80 || avatarName.length > 80 || telegramBotToken.length > 256) {
      return onboardingRedirect(request, "missing_fields", next, "enrolment");
    }

    if (avatarGender !== "female" && avatarGender !== "male") {
      return onboardingRedirect(request, "missing_fields", next, "enrolment");
    }

    const { error } = await supabase.from("profiles").upsert(
      {
        id: userId,
        email,
        owner_name: ownerName,
        avatar_name: avatarName,
        avatar_gender: avatarGender,
        telegram_bot_token: telegramBotToken || null,
        enrolment_completed_at: new Date().toISOString()
      },
      { onConflict: "id" }
    );

    if (error) {
      return onboardingRedirect(request, "save_failed", next, "enrolment");
    }

    return NextResponse.redirect(appUrl(onboardingPath(next, "avatar"), request), {
      status: 303
    });
  }

  if (step === "agent") {
    const provisionTarget = String(formData.get("provisionTarget") ?? "").trim();

    if (provisionTarget === "chat_only") {
      const { data: existing, error: profileError } = await supabase.from("profiles").select(onboardingProfileSelect).eq("id", userId).maybeSingle();
      const profile = existing as OnboardingProfile | null;
      if (profileError || !profile?.owner_name?.trim() || !profile.avatar_name?.trim() || !profile.avatar_gender?.trim() || !profile.enrolment_completed_at || !profile.avatar_glb_path?.trim() || !profile.avatar_completed_at) {
        return onboardingRedirect(request, "missing_fields", next, "agent");
      }
      if (profile.openclaw_instance?.trim() || profile.openclaw_provision_status === "running") {
        return onboardingRedirect(request, "openclaw_provision_running", next, "provision");
      }
      const { data: skipped, error } = await supabase.from("profiles")
        .update({ provision_target: "chat_only", openclaw_provision_status: "skipped", onboarding_completed_at: new Date().toISOString() })
        .eq("id", userId).is("openclaw_instance", null)
        .or("openclaw_provision_status.is.null,openclaw_provision_status.neq.running")
        .select("id").maybeSingle();
      if (error) return onboardingRedirect(request, "save_failed", next, "agent");
      if (!skipped) return onboardingRedirect(request, "openclaw_provision_running", next, "provision");
      return NextResponse.redirect(appUrl("/dashboard/chat", request), { status: 303 });
    }

    if (provisionTarget !== "openclaw" && provisionTarget !== "hermes_agent") {
      return onboardingRedirect(request, "invalid_provision_target", next, "agent");
    }

    const { error } = await supabase.from("profiles").upsert(
      {
        id: userId,
        email,
        provision_target: provisionTarget,
        onboarding_completed_at: null
      },
      { onConflict: "id" }
    );

    if (error) {
      return onboardingRedirect(request, "save_failed", next, "agent");
    }

    return NextResponse.redirect(appUrl(onboardingPath(next, "provision"), request), {
      status: 303
    });
  }

  const avatarSource = String(formData.get("avatarSource") ?? "").trim();
  const avatarUpload = formData.get("avatarGlb");
  const avaturnAvatarUrl = String(formData.get("avaturnAvatarUrl") ?? "").trim();
  const avaturnPayload = parseJsonObject(String(formData.get("avaturnPayload") ?? ""));

  if (!avaturnAvatarUrl && !isUploadedFile(avatarUpload)) {
    return onboardingRedirect(request, "missing_avatar", next, "avatar");
  }

  let storedAvatar: Awaited<ReturnType<typeof downloadAvaturnGlb>>;
  const shouldUseUpload = avatarSource === "upload" && isUploadedFile(avatarUpload);

  try {
    storedAvatar = shouldUseUpload
      ? await storeUploadedAvaturnGlb(avatarUpload, userId)
      : await downloadAvaturnGlb(avaturnAvatarUrl, userId);
  } catch (error) {
    const code = error instanceof Error ? error.message : "avatar_download_failed";
    return onboardingRedirect(request, code, next, "avatar");
  }

  const avatarPayload =
    shouldUseUpload && isUploadedFile(avatarUpload)
      ? {
          fileName: "name" in avatarUpload ? avatarUpload.name : "avatar.glb",
          source: "manual_upload",
          size: avatarUpload.size
        }
      : avaturnPayload;

  const { error } = await supabase.from("profiles").upsert(
    {
      id: userId,
      email,
      avaturn_avatar_url: avaturnAvatarUrl || null,
      avaturn_avatar_payload: avatarPayload,
      avatar_completed_at: new Date().toISOString(),
      avatar_glb_path: storedAvatar.relativePath,
      avatar_glb_bytes: storedAvatar.byteLength,
      avatar_glb_downloaded_at: new Date().toISOString()
    },
    { onConflict: "id" }
  );

  if (error) {
    return onboardingRedirect(request, "save_failed", next, "avatar");
  }

  return NextResponse.redirect(appUrl(onboardingPath(next, "provision"), request), {
    status: 303
  });
}
