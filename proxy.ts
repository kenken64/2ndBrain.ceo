import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { appUrl } from "@/lib/url";

function isProtectedAppPath(pathname: string) {
  return (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/intent") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/api/account") ||
    pathname.startsWith("/api/openclaw") ||
    pathname.startsWith("/api/projects") ||
    pathname.startsWith("/api/settings") ||
    pathname.startsWith("/api/wiki")
  );
}

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.searchParams.has("code") &&
    request.nextUrl.pathname !== "/auth/callback"
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
        .select("admin_disabled,admin_deleted_at")
        .eq("id", userId)
        .maybeSingle();

      if (!data?.admin_disabled && !data?.admin_deleted_at) {
        return response;
      }

      if (request.nextUrl.pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Account access is disabled" }, { status: 403 });
      }

      return NextResponse.redirect(appUrl("/disabled", request));
    }
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
  ]
};
