import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { appUrl } from "@/lib/url";

function isProtectedAppPath(pathname: string) {
  return (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/intent") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/api/account") ||
    pathname.startsWith("/api/billing") ||
    pathname.startsWith("/api/openclaw") ||
    pathname.startsWith("/api/projects") ||
    pathname.startsWith("/api/settings") ||
    pathname.startsWith("/api/wiki")
  );
}

function isCreditLockAllowedPath(pathname: string) {
  return (
    pathname === "/dashboard/settings" ||
    pathname === "/dashboard/settings/" ||
    pathname === "/api/account/destroy-workspace" ||
    pathname.startsWith("/api/openclaw/gws-auth") ||
    pathname.startsWith("/api/billing") ||
    pathname.startsWith("/onboarding")
  );
}

function isOAuthCodeCallbackPath(pathname: string) {
  return pathname === "/auth/callback" || pathname === "/api/openclaw/gws-auth/callback";
}

function getAvailableAiCredits(profile: {
  llm_token_quota?: number | string | null;
  llm_token_used?: number | string | null;
}) {
  const quota = Number(profile.llm_token_quota ?? 0);
  const used = Number(profile.llm_token_used ?? 0);

  return quota - used;
}

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.searchParams.has("code") &&
    !isOAuthCodeCallbackPath(request.nextUrl.pathname)
  ) {
    const callbackUrl = appUrl(`/auth/callback${request.nextUrl.search}`, request);
    return NextResponse.redirect(callbackUrl);
  }

  return updateSession(request, {
    onAuthenticated: async ({ response, supabase, userId }) => {
      if (!isProtectedAppPath(request.nextUrl.pathname)) {
        return response;
      }

      const { data } = await supabase
        .from("profiles")
        .select("admin_disabled,admin_deleted_at,llm_token_quota,llm_token_used")
        .eq("id", userId)
        .maybeSingle();

      if (data?.admin_disabled || data?.admin_deleted_at) {
        if (request.nextUrl.pathname.startsWith("/api/")) {
          return NextResponse.json({ error: "Account access is disabled" }, { status: 403 });
        }

        return NextResponse.redirect(appUrl("/disabled", request));
      }

      const isCreditLocked = Boolean(data) && getAvailableAiCredits(data) <= 0;

      if (isCreditLocked && !isCreditLockAllowedPath(request.nextUrl.pathname)) {
        if (request.nextUrl.pathname.startsWith("/api/")) {
          return NextResponse.json(
            {
              error: "AI credits are required.",
              code: "ai_credits_required"
            },
            { status: 402 }
          );
        }

        return NextResponse.redirect(
          appUrl("/dashboard/settings?tab=payment&creditStatus=empty", request)
        );
      }

      return response;
    }
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
  ]
};
