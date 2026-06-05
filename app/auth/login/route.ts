import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { appUrl, getRequestOrigin, safeNextPath } from "@/lib/url";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const next = safeNextPath(requestUrl.searchParams.get("next"));
  const loginHint = requestUrl.searchParams.get("login_hint")?.trim();

  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(
      appUrl(`/login?error=supabase_config&next=${encodeURIComponent(next)}`, request)
    );
  }

  const origin = getRequestOrigin(request);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
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
