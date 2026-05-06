import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import {
  getUserIdFromClaims,
  isOnboardingComplete,
  onboardingPath,
  onboardingProfileSelect
} from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/url";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeNextPath(requestUrl.searchParams.get("next"));

  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(
      new URL(`/login?error=supabase_config&next=${encodeURIComponent(next)}`, request.url)
    );
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const { data: claimsData } = await supabase.auth.getClaims();
      const userId = getUserIdFromClaims(claimsData?.claims);

      if (userId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select(onboardingProfileSelect)
          .eq("id", userId)
          .maybeSingle();

        if (!isOnboardingComplete(profile)) {
          return NextResponse.redirect(new URL(onboardingPath(next), request.url));
        }
      }

      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth_callback", request.url));
}
