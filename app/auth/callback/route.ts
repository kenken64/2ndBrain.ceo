import { after, NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import {
  getUserIdFromClaims,
  isOnboardingComplete,
  onboardingPath,
  onboardingProfileSelect,
  type OnboardingProfile
} from "@/lib/onboarding";
import { logoutOpenClawGoogleWorkspace } from "@/lib/openclaw";
import { createClient } from "@/lib/supabase/server";
import { appUrl, safeNextPath } from "@/lib/url";

function scheduleGoogleWorkspaceLogout(instance: string, userId: string) {
  after(async () => {
    try {
      const result = await logoutOpenClawGoogleWorkspace({ instance });

      console.info(
        "[auth:gws-logout] complete",
        JSON.stringify({
          output: result.output,
          userId
        })
      );
    } catch (error) {
      console.warn(
        "[auth:gws-logout] failed",
        JSON.stringify({
          message: error instanceof Error ? error.message : "gws_logout_failed",
          userId
        })
      );
    }
  });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeNextPath(requestUrl.searchParams.get("next"));

  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(
      appUrl(`/login?error=supabase_config&next=${encodeURIComponent(next)}`, request)
    );
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const { data: claimsData } = await supabase.auth.getClaims();
      const userId = getUserIdFromClaims(claimsData?.claims);

      if (userId) {
        const email = typeof claimsData?.claims?.email === "string" ? claimsData.claims.email : null;

        await supabase.from("profiles").upsert(
          {
            id: userId,
            email
          },
          { onConflict: "id" }
        );

        const { data: profile } = await supabase
          .from("profiles")
          .select(onboardingProfileSelect)
          .eq("id", userId)
          .maybeSingle();
        const onboardingProfile = profile as OnboardingProfile | null;

        if (!isOnboardingComplete(onboardingProfile)) {
          return NextResponse.redirect(appUrl(onboardingPath(next), request));
        }

        const openClawInstance = onboardingProfile?.openclaw_instance?.trim();

        if (openClawInstance) {
          scheduleGoogleWorkspaceLogout(openClawInstance, userId);
        }
      }

      return NextResponse.redirect(appUrl(next, request));
    }
  }

  return NextResponse.redirect(appUrl("/login?error=auth_callback", request));
}
