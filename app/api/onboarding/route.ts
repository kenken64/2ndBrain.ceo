import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/url";

function onboardingRedirect(request: Request, error: string, next: string) {
  return NextResponse.redirect(
    new URL(`/onboarding?error=${error}&next=${encodeURIComponent(next)}`, request.url),
    { status: 303 }
  );
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
  const avatarName = String(formData.get("avatarName") ?? "").trim();
  const telegramBotToken = String(formData.get("telegramBotToken") ?? "").trim();

  if (!avatarName || !telegramBotToken) {
    return onboardingRedirect(request, "missing_fields", next);
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = getUserIdFromClaims(claims);

  if (claimsError || !userId) {
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent("/onboarding")}`, request.url),
      { status: 303 }
    );
  }

  const { error } = await supabase.from("profiles").upsert(
    {
      id: userId,
      email: typeof claims?.email === "string" ? claims.email : null,
      avatar_name: avatarName,
      telegram_bot_token: telegramBotToken,
      onboarding_completed_at: new Date().toISOString()
    },
    { onConflict: "id" }
  );

  if (error) {
    return onboardingRedirect(request, "save_failed", next);
  }

  return NextResponse.redirect(new URL(next, request.url), { status: 303 });
}
