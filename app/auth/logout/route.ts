import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { appUrl, safeNextPath } from "@/lib/url";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const next = safeNextPath(requestUrl.searchParams.get("next") ?? "/");

  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }

  return NextResponse.redirect(appUrl(next, request));
}
