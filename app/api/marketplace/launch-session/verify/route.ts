import { checkMarketplaceLaunchAccess } from "@/lib/marketplace-session-access";
import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type VerifyPayload = {
  installId?: unknown;
  issuedAt?: unknown;
  toolId?: unknown;
  userId?: unknown;
};

function cleanEnvValue(value: string | undefined) {
  const cleaned = value?.trim().replace(/^['"]|['"]$/g, "");

  return cleaned || null;
}

function configuredVerifySecret() {
  return cleanEnvValue(process.env.MARKETPLACE_LAUNCH_VERIFY_SECRET);
}

function requestVerifySecret(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  return bearer || request.headers.get("x-marketplace-launch-verify-secret")?.trim() || null;
}

function unauthorized(message = "Invalid marketplace launch verification secret.") {
  return NextResponse.json({ active: false, error: message }, { status: 401 });
}

function inactive(message: string, status = 403) {
  return NextResponse.json({ active: false, error: message }, { status });
}

export async function POST(request: Request) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ active: false, error: "Supabase is not configured." }, { status: 503 });
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return NextResponse.json(
      { active: false, error: "SUPABASE_SERVICE_ROLE_KEY is required for marketplace launch verification." },
      { status: 503 }
    );
  }

  const verifySecret = configuredVerifySecret();

  if (!verifySecret || Buffer.byteLength(verifySecret) < 32) {
    return NextResponse.json(
      { active: false, error: "MARKETPLACE_LAUNCH_VERIFY_SECRET must be at least 32 bytes." },
      { status: 503 }
    );
  }

  if (requestVerifySecret(request) !== verifySecret) {
    return unauthorized();
  }

  const payload = (await request.json().catch(() => null)) as VerifyPayload | null;
  const userId = typeof payload?.userId === "string" ? payload.userId.trim() : "";
  const installId = typeof payload?.installId === "string" ? payload.installId.trim() : "";
  const toolId = typeof payload?.toolId === "string" ? payload.toolId.trim() : "";
  const issuedAt = Number(payload?.issuedAt);

  if (!userId || !installId || !toolId || !Number.isFinite(issuedAt)) {
    return inactive("Invalid marketplace launch session payload.", 400);
  }

  const access = await checkMarketplaceLaunchAccess({ userId, installId, toolId, issuedAt });
  if (!access.active) return inactive(access.error, access.status);

  return NextResponse.json(
    {
      active: true,
      checkedAt: new Date().toISOString()
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
