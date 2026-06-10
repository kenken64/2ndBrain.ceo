import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import {
  getUserIdFromClaims,
  isOnboardingComplete,
  onboardingPath,
  onboardingProfileSelect,
  type OnboardingProfile
} from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { appUrl, safeNextPath } from "@/lib/url";

type GoogleWorkspaceLoginProfile = OnboardingProfile & {
  google_workspace_enabled?: boolean | null;
};

function googleWorkspaceLoginPath(next: string) {
  const params = new URLSearchParams({
    gwsAuth: "login",
    tab: "integrations"
  });

  if (next && next !== "/dashboard/settings") {
    params.set("next", next);
  }

  return `/dashboard/settings?${params.toString()}`;
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
          .select(`${onboardingProfileSelect},google_workspace_enabled`)
          .eq("id", userId)
          .maybeSingle();
        const onboardingProfile = profile as GoogleWorkspaceLoginProfile | null;

        if (!isOnboardingComplete(onboardingProfile)) {
          return NextResponse.redirect(appUrl(onboardingPath(next), request));
        }

        const openClawInstance = onboardingProfile?.openclaw_instance?.trim();
        const googleWorkspaceEnabled = Boolean(onboardingProfile?.google_workspace_enabled);

        if (openClawInstance && googleWorkspaceEnabled) {
          return NextResponse.redirect(appUrl(googleWorkspaceLoginPath(next), request));
        }
      }

      return NextResponse.redirect(appUrl(next, request));
    }
  }

  return NextResponse.redirect(appUrl("/login?error=auth_callback", request));
}
