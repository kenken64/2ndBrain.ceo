import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { workflowLaunchConfigByToolId } from "@/lib/workflow-launch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type VerifyPayload = {
  installId?: unknown;
  issuedAt?: unknown;
  toolId?: unknown;
  userId?: unknown;
};

type ProfileRow = {
  admin_deleted_at: string | null;
  admin_disabled: boolean | null;
  marketplace_launch_revoked_at: string | null;
};

type InstallRow = {
  id: string;
  item_id: string;
  status: string;
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

function revokedAtSeconds(value: string | null) {
  if (!value) {
    return null;
  }

  const timestampMs = Date.parse(value);

  if (!Number.isFinite(timestampMs)) {
    return null;
  }

  return Math.floor(timestampMs / 1000);
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

  const launchConfig = workflowLaunchConfigByToolId(toolId);

  if (!launchConfig) {
    return inactive("Unknown workflow tool.", 400);
  }

  const adminSupabase = createAdminClient();
  const { data: profileRow, error: profileError } = await adminSupabase
    .from("profiles")
    .select("admin_deleted_at,admin_disabled,marketplace_launch_revoked_at")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ active: false, error: profileError.message }, { status: 500 });
  }

  if (!profileRow) {
    return inactive("Profile was not found.", 404);
  }

  const profile = profileRow as ProfileRow;

  if (profile.admin_disabled || profile.admin_deleted_at) {
    return inactive("Account access is disabled.");
  }

  const revokedSeconds = revokedAtSeconds(profile.marketplace_launch_revoked_at);

  if (revokedSeconds !== null && Math.trunc(issuedAt) <= revokedSeconds) {
    return inactive("2ndBrain session has been logged out.");
  }

  const { data: installRow, error: installError } = await adminSupabase
    .from("marketplace_installs")
    .select("id,item_id,status")
    .eq("id", installId)
    .eq("user_id", userId)
    .maybeSingle();

  if (installError) {
    return NextResponse.json({ active: false, error: installError.message }, { status: 500 });
  }

  if (!installRow) {
    return inactive("Installed workflow tool was not found.", 404);
  }

  const install = installRow as InstallRow;

  if (install.item_id !== launchConfig.itemId || install.status !== "installed") {
    return inactive("Workflow tool is not active.");
  }

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
