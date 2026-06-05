import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({
      authenticated: false,
      error: "Supabase is not configured",
      serviceRoleConfigured: hasSupabaseServiceRoleEnv()
    }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(claimsData?.claims);
  const email = typeof claimsData?.claims?.email === "string" ? claimsData.claims.email.toLowerCase() : "";

  if (claimsError || !userId || !email) {
    return NextResponse.json({
      authenticated: false,
      error: "Authentication required",
      serviceRoleConfigured: hasSupabaseServiceRoleEnv()
    }, { status: 401 });
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return NextResponse.json({
      adminMatch: false,
      authenticated: true,
      email,
      serviceRoleConfigured: false,
      userId
    });
  }

  const adminSupabase = createAdminClient();
  const normalizedEmail = email.trim().toLowerCase();
  const { data, error } = await adminSupabase
    .from("admin_users")
    .select("email,enabled,user_id")
    .or(`email.eq.${normalizedEmail},user_id.eq.${userId}`)
    .maybeSingle();

  if (error) {
    return NextResponse.json({
      adminMatch: false,
      adminQueryError: {
        code: error.code,
        message: error.message
      },
      authenticated: true,
      email,
      serviceRoleConfigured: true,
      userId
    }, { status: 500 });
  }

  return NextResponse.json({
    adminMatch: Boolean(data?.enabled),
    adminRow: data
      ? {
          email: data.email,
          enabled: data.enabled,
          linkedUser: Boolean(data.user_id),
          userIdMatches: data.user_id === userId
        }
      : null,
    authenticated: true,
    email,
    serviceRoleConfigured: true,
    userId
  });
}
