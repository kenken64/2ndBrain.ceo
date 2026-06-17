import { NextResponse } from "next/server";
import { getConfiguredSiteUrls, hasSupabaseEnv } from "@/lib/env";
import {
  getUserIdFromClaims,
  isOnboardingComplete,
  onboardingPath,
  onboardingProfileSelect,
  type OnboardingProfile
} from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { appUrl, getRequestOrigin, safeNextPath } from "@/lib/url";

type GoogleWorkspaceLoginProfile = OnboardingProfile & {
  google_workspace_connected_at?: string | null;
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

function authErrorCode(error: unknown) {
  if (!error || typeof error !== "object") {
    return "auth_callback";
  }

  const code = "code" in error && typeof error.code === "string" ? error.code : null;
  const name = "name" in error && typeof error.name === "string" ? error.name : null;

  return code ?? name ?? "auth_callback";
}

function hasCodeVerifierCookie(request: Request) {
  return /(?:^|;\s*)sb-[^=;]+-auth-token-code-verifier=/.test(
    request.headers.get("cookie") ?? ""
  );
}

function getAllowedCallbackOrigin(value: string | null, fallbackOrigin: string) {
  if (!value) {
    return fallbackOrigin;
  }

  try {
    const origin = new URL(value).origin;
    const allowedOrigins = new Set([fallbackOrigin, ...getConfiguredSiteUrls()]);

    return allowedOrigins.has(origin) || isLocalDevCallbackOrigin(origin) ? origin : fallbackOrigin;
  } catch {
    return fallbackOrigin;
  }
}

function isLocalDevCallbackOrigin(origin: string) {
  try {
    const url = new URL(origin);
    const isLoopbackHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";

    return isLoopbackHost && url.port === "3000";
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeNextPath(requestUrl.searchParams.get("next"));
  const oauthError = requestUrl.searchParams.get("error")?.trim();

  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(
      appUrl(`/login?error=supabase_config&next=${encodeURIComponent(next)}`, request)
    );
  }

  if (oauthError) {
    return NextResponse.redirect(
      appUrl(
        `/login?error=${encodeURIComponent(oauthError)}&next=${encodeURIComponent(next)}`,
        request
      )
    );
  }

  if (code) {
    const origin = getRequestOrigin(request);
    const codeVerifierCookieFound = hasCodeVerifierCookie(request);
    const callbackOrigin = getAllowedCallbackOrigin(
      requestUrl.searchParams.get("callback_origin"),
      origin
    );

    if (
      !codeVerifierCookieFound &&
      callbackOrigin !== requestUrl.origin &&
      requestUrl.searchParams.get("origin_retry") !== "1"
    ) {
      const retryUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, callbackOrigin);

      retryUrl.searchParams.set("origin_retry", "1");

      return NextResponse.redirect(retryUrl);
    }

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
          .select(`${onboardingProfileSelect},google_workspace_enabled,google_workspace_connected_at`)
          .eq("id", userId)
          .maybeSingle();
        const onboardingProfile = profile as GoogleWorkspaceLoginProfile | null;

        if (!isOnboardingComplete(onboardingProfile)) {
          return NextResponse.redirect(appUrl(onboardingPath(next), request));
        }

        const openClawInstance = onboardingProfile?.openclaw_instance?.trim();
        const googleWorkspaceEnabled = Boolean(onboardingProfile?.google_workspace_enabled);
        const googleWorkspaceConnected = Boolean(onboardingProfile?.google_workspace_connected_at);

        if (openClawInstance && googleWorkspaceEnabled && !googleWorkspaceConnected) {
          return NextResponse.redirect(appUrl(googleWorkspaceLoginPath(next), request));
        }
      }

      return NextResponse.redirect(appUrl(next, request));
    }

    const errorCode = authErrorCode(error);

    console.error("[auth] callback exchange failed", {
      callbackOrigin,
      errorCode,
      hasCodeVerifierCookie: codeVerifierCookieFound,
      origin,
      rawOrigin: requestUrl.origin
    });

    return NextResponse.redirect(
      appUrl(
        `/login?error=${encodeURIComponent(errorCode)}&next=${encodeURIComponent(next)}`,
        request
      )
    );
  }

  return NextResponse.redirect(appUrl("/login?error=auth_callback", request));
}
