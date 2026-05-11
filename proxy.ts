import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { appUrl } from "@/lib/url";

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.searchParams.has("code") &&
    request.nextUrl.pathname !== "/auth/callback"
  ) {
    const callbackUrl = appUrl(`/auth/callback${request.nextUrl.search}`, request);
    return NextResponse.redirect(callbackUrl);
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
  ]
};
