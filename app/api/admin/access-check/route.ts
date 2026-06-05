import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import {
  createAdminClient,
  getSupabaseServiceRoleKeySource,
  hasSupabaseServiceRoleEnv
} from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const PUBLIC_KEY_ENV_NAMES = [
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY"
] as const;

function cleanEnvValue(value: string | undefined) {
  const cleaned = value?.trim().replace(/^['"]|['"]$/g, "");
  return cleaned || null;
}

function getPublicKeySource() {
  for (const name of PUBLIC_KEY_ENV_NAMES) {
    const value = cleanEnvValue(process.env[name]);

    if (value) {
      return { name, value };
    }
  }

  return null;
}

function decodeJwtPart(value: string) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function keyDiagnostics(source: { name: string; value: string } | null) {
  if (!source) {
    return {
      configured: false
    };
  }

  const parts = source.value.split(".");
  const header = parts.length >= 1 ? decodeJwtPart(parts[0]) : null;
  const payload = parts.length >= 2 ? decodeJwtPart(parts[1]) : null;

  return {
    alg: typeof header?.alg === "string" ? header.alg : null,
    configured: true,
    exp: typeof payload?.exp === "number" ? payload.exp : null,
    fingerprint: crypto.createHash("sha256").update(source.value).digest("hex").slice(0, 12),
    iat: typeof payload?.iat === "number" ? payload.iat : null,
    iss: typeof payload?.iss === "string" ? payload.iss : null,
    parts: parts.length,
    role: typeof payload?.role === "string" ? payload.role : null,
    source: source.name,
    typ: typeof header?.typ === "string" ? header.typ : null
  };
}

export async function GET() {
  const publicKey = keyDiagnostics(getPublicKeySource());
  const serviceKey = keyDiagnostics(getSupabaseServiceRoleKeySource());

  if (!hasSupabaseEnv()) {
    return NextResponse.json({
      authenticated: false,
      error: "Supabase is not configured",
      publicKey,
      serviceKey,
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
      publicKey,
      serviceKey,
      serviceRoleConfigured: hasSupabaseServiceRoleEnv()
    }, { status: 401 });
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return NextResponse.json({
      adminMatch: false,
      authenticated: true,
      email,
      publicKey,
      serviceKey,
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
      publicKey,
      serviceKey,
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
    publicKey,
    serviceKey,
    serviceRoleConfigured: true,
    userId
  });
}
