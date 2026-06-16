import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSupabaseEnv } from "@/lib/env";
import { updateSession } from "@/lib/supabase/proxy";
import { appUrl } from "@/lib/url";

const SUPABASE_SERVICE_ROLE_ENV_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "SERVICE_ROLE_KEY"
] as const;

function cleanEnvValue(value: string | undefined) {
  const cleaned = value?.trim().replace(/^['"]|['"]$/g, "");
  return cleaned || null;
}

function getSupabaseServiceRoleKey() {
  for (const name of SUPABASE_SERVICE_ROLE_ENV_NAMES) {
    const value = cleanEnvValue(process.env[name]);

    if (value) {
      return value;
    }
  }

  return null;
}

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

async function isEnabledAdminUser(input: { email: string | null; userId: string }) {
  const serviceRoleKey = getSupabaseServiceRoleKey();
  const normalizedEmail = input.email?.trim().toLowerCase();

  if (!serviceRoleKey || !normalizedEmail) {
    return false;
  }

  try {
    const { supabaseUrl } = getSupabaseEnv();
    const url = new URL("/rest/v1/admin_users", supabaseUrl);

    url.searchParams.set("select", "id");
    url.searchParams.set("enabled", "eq.true");
    url.searchParams.set("or", `(email.eq.${normalizedEmail},user_id.eq.${input.userId})`);
    url.searchParams.set("limit", "1");

    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`
      }
    });

    if (!response.ok) {
      return false;
    }

    const rows = (await response.json().catch(() => [])) as unknown;

    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.searchParams.has("code") &&
    !isOAuthCodeCallbackPath(request.nextUrl.pathname)
  ) {
    const callbackUrl = appUrl(`/auth/callback${request.nextUrl.search}`, request);
    return NextResponse.redirect(callbackUrl);
  }

  if (
    request.nextUrl.searchParams.has("code") &&
    isOAuthCodeCallbackPath(request.nextUrl.pathname)
  ) {
    return NextResponse.next({ request });
  }

  return updateSession(request, {
    onAuthenticated: async ({ email, response, supabase, userId }) => {
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

      const isAdmin = await isEnabledAdminUser({ email, userId });
      console.log("[auth] admin role", {
        isAdmin,
        pathname: request.nextUrl.pathname,
        userId
      });
      const isCreditLocked = !isAdmin && Boolean(data) && getAvailableAiCredits(data) <= 0;

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
