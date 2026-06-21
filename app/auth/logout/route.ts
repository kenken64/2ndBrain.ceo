import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { appUrl, safeNextPath } from "@/lib/url";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const next = safeNextPath(requestUrl.searchParams.get("next") ?? "/");

  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const userId = getUserIdFromClaims(data?.claims);

    if (userId) {
      const revokedAt = new Date().toISOString();
      const client = hasSupabaseServiceRoleEnv() ? createAdminClient() : supabase;
      const { error } = await client
        .from("profiles")
        .update({ marketplace_launch_revoked_at: revokedAt })
        .eq("id", userId);

      if (error) {
        console.error("Failed to revoke marketplace launch sessions during logout", error);
      }
    }

    await supabase.auth.signOut();
  }

  return NextResponse.redirect(appUrl(next, request));
}
