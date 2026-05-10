import { NextResponse } from "next/server";
import { downloadAvaturnGlb } from "@/lib/avaturn";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims, onboardingPath, parseOnboardingStep } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/url";

export const runtime = "nodejs";

function onboardingRedirect(request: Request, error: string, next: string, step = "profile") {
  return NextResponse.redirect(
    new URL(
      `/onboarding?step=${encodeURIComponent(step)}&error=${error}&next=${encodeURIComponent(next)}`,
      request.url
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

export async function POST(request: Request) {
  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(
      new URL("/login?error=supabase_config&next=/onboarding", request.url),
      { status: 303 }
    );
  }

  const formData = await request.formData();
  const next = safeNextPath(String(formData.get("next") ?? "/dashboard"));
  const step = parseOnboardingStep(String(formData.get("step") ?? "profile")) ?? "profile";

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = getUserIdFromClaims(claims);

  if (claimsError || !userId) {
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(onboardingPath(next, step))}`, request.url),
      { status: 303 }
    );
  }

  const email = typeof claims?.email === "string" ? claims.email : null;

  if (step === "profile") {
    const avatarName = String(formData.get("avatarName") ?? "").trim();

    if (!avatarName) {
      return onboardingRedirect(request, "missing_fields", next, "profile");
    }

    const { error } = await supabase.from("profiles").upsert(
      {
        id: userId,
        email,
        avatar_name: avatarName
      },
      { onConflict: "id" }
    );

    if (error) {
      return onboardingRedirect(request, "save_failed", next, "profile");
    }

    return NextResponse.redirect(new URL(onboardingPath(next, "telegram"), request.url), {
      status: 303
    });
  }

  if (step === "telegram") {
    const telegramBotToken = String(formData.get("telegramBotToken") ?? "").trim();

    if (!telegramBotToken) {
      return onboardingRedirect(request, "missing_fields", next, "telegram");
    }

    const { error } = await supabase.from("profiles").upsert(
      {
        id: userId,
        email,
        telegram_bot_token: telegramBotToken
      },
      { onConflict: "id" }
    );

    if (error) {
      return onboardingRedirect(request, "save_failed", next, "telegram");
    }

    return NextResponse.redirect(new URL(onboardingPath(next, "avatar"), request.url), {
      status: 303
    });
  }

  const avaturnAvatarUrl = String(formData.get("avaturnAvatarUrl") ?? "").trim();
  const avaturnPayload = parseJsonObject(String(formData.get("avaturnPayload") ?? ""));

  if (!avaturnAvatarUrl) {
    return onboardingRedirect(request, "missing_avatar", next, "avatar");
  }

  let downloadedAvatar: Awaited<ReturnType<typeof downloadAvaturnGlb>>;

  try {
    downloadedAvatar = await downloadAvaturnGlb(avaturnAvatarUrl, userId);
  } catch (error) {
    const code = error instanceof Error ? error.message : "avatar_download_failed";
    return onboardingRedirect(request, code, next, "avatar");
  }

  const { error } = await supabase.from("profiles").upsert(
    {
      id: userId,
      email,
      avaturn_avatar_url: avaturnAvatarUrl,
      avaturn_avatar_payload: avaturnPayload,
      avatar_glb_path: downloadedAvatar.relativePath,
      avatar_glb_bytes: downloadedAvatar.byteLength,
      avatar_glb_downloaded_at: new Date().toISOString(),
      onboarding_completed_at: new Date().toISOString()
    },
    { onConflict: "id" }
  );

  if (error) {
    return onboardingRedirect(request, "save_failed", next, "avatar");
  }

  return NextResponse.redirect(new URL(next, request.url), { status: 303 });
}
