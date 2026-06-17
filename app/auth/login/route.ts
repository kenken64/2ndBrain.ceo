import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { appUrl, getIncomingRequestOrigin, getRequestOrigin, safeNextPath } from "@/lib/url";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const next = safeNextPath(requestUrl.searchParams.get("next"));
  const loginHint = requestUrl.searchParams.get("login_hint")?.trim();

  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(
      appUrl(`/login?error=supabase_config&next=${encodeURIComponent(next)}`, request)
    );
  }

  const incomingOrigin = getIncomingRequestOrigin(request);
  const origin = getRequestOrigin(request);

  if (origin !== incomingOrigin) {
    return NextResponse.redirect(
      new URL(`/auth/login?next=${encodeURIComponent(next)}`, origin)
    );
  }

  const supabase = await createClient();
  const callbackUrl = new URL("/auth/callback", origin);

  callbackUrl.searchParams.set("next", next);
  callbackUrl.searchParams.set("callback_origin", origin);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl.toString(),
      queryParams: {
        access_type: "offline",
        ...(loginHint ? { login_hint: loginHint } : {}),
        prompt: "select_account consent"
      }
    }
  });

  if (error || !data.url) {
    return NextResponse.redirect(
      appUrl(`/login?error=${encodeURIComponent(error?.message ?? "oauth_url")}`, request)
    );
  }

  return NextResponse.redirect(data.url);
}
