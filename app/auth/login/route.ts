import { NextResponse } from "next/server";
import { hasSupabaseEnv, isWechatLoginEnabled } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { appUrl, getIncomingRequestOrigin, getRequestOrigin, safeNextPath } from "@/lib/url";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const next = safeNextPath(requestUrl.searchParams.get("next"), "/dashboard/chat");
  const loginHint = requestUrl.searchParams.get("login_hint")?.trim();
  const pkceRetry = requestUrl.searchParams.get("pkce_retry") === "1";
  const requestedProvider = requestUrl.searchParams.get("provider") ?? "google";

  if (requestedProvider !== "google" && requestedProvider !== "wechat") {
    return NextResponse.redirect(appUrl(`/login?error=unsupported_provider&next=${encodeURIComponent(next)}`, request));
  }
  if (requestedProvider === "wechat" && !isWechatLoginEnabled()) {
    return NextResponse.redirect(appUrl(`/login?error=wechat_unavailable&next=${encodeURIComponent(next)}`, request));
  }

  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(
      appUrl(`/login?error=supabase_config&next=${encodeURIComponent(next)}`, request)
    );
  }

  const incomingOrigin = getIncomingRequestOrigin(request);
  const origin = getRequestOrigin(request);

  if (origin !== incomingOrigin) {
    const canonical = new URL("/auth/login", origin);
    canonical.searchParams.set("next", next);
    if (requestedProvider === "wechat") canonical.searchParams.set("provider", "wechat");
    if (loginHint && requestedProvider === "google") canonical.searchParams.set("login_hint", loginHint);
    if (pkceRetry) canonical.searchParams.set("pkce_retry", "1");
    return NextResponse.redirect(canonical);
  }

  const supabase = await createClient();
  const callbackUrl = new URL("/auth/callback", origin);

  callbackUrl.searchParams.set("next", next);
  callbackUrl.searchParams.set("callback_origin", origin);
  if (requestedProvider === "wechat") callbackUrl.searchParams.set("provider", "wechat");
  if (pkceRetry) {
    callbackUrl.searchParams.set("pkce_retry", "1");
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: requestedProvider === "wechat" ? "custom:wechat" : "google",
    options: {
      redirectTo: callbackUrl.toString(),
      ...(requestedProvider === "google" ? { queryParams: {
        access_type: "offline",
        ...(loginHint ? { login_hint: loginHint } : {}),
        prompt: "select_account consent"
      } } : {})
    }
  });

  if (error || !data.url) {
    return NextResponse.redirect(
      appUrl(`/login?error=${encodeURIComponent(error?.message ?? "oauth_url")}`, request)
    );
  }

  return NextResponse.redirect(data.url);
}
