import { NextResponse } from "next/server";
import { getAdminAccess, logAdminAudit } from "@/lib/admin";
import { bedrockTokenLast4, getAdminTargetProfile } from "@/lib/admin-workspace";
import { updateOpenClawBedrockBearerToken } from "@/lib/openclaw";

export const runtime = "nodejs";
export const maxDuration = 900;

type AdminUserRouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

export async function POST(request: Request, context: AdminUserRouteContext) {
  const access = await getAdminAccess();

  if (!access.ok) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }

  if (!access.adminSupabase) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required" }, { status: 503 });
  }

  const { userId } = await context.params;
  const payload = (await request.json().catch(() => null)) as { bearerToken?: unknown; envFile?: unknown } | null;
  const bearerToken = typeof payload?.bearerToken === "string" ? payload.bearerToken.trim() : "";
  const envFile = typeof payload?.envFile === "string" ? payload.envFile.trim() : null;

  if (!bearerToken) {
    return NextResponse.json({ error: "Bedrock bearer token is required" }, { status: 400 });
  }

  const target = await getAdminTargetProfile(access.adminSupabase, userId);
  const instance = target.openclaw_instance?.trim();

  if (!instance) {
    return NextResponse.json({ error: "Target user has no AI Agent instance" }, { status: 409 });
  }

  try {
    const result = await updateOpenClawBedrockBearerToken({
      bearerToken,
      envFile,
      instance
    });
    const completedAt = new Date().toISOString();

    const { error } = await access.adminSupabase
      .from("profiles")
      .update({
        bedrock_token_last4: bedrockTokenLast4(bearerToken),
        bedrock_token_updated_at: completedAt,
        bedrock_token_updated_by: access.userId
      })
      .eq("id", userId);

    if (error) {
      throw new Error(error.message);
    }

    await logAdminAudit(access.adminSupabase, {
      action: "bedrock_token_overwrite",
      adminEmail: access.email,
      adminUserId: access.userId,
      details: {
        envFile: envFile || null,
        instance,
        outputLength: result.output.length
      },
      targetEmail: target.email,
      targetUserId: userId
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "bedrock_token_update_failed";

    await logAdminAudit(access.adminSupabase, {
      action: "bedrock_token_overwrite",
      adminEmail: access.email,
      adminUserId: access.userId,
      details: {
        error: message,
        instance
      },
      status: "failed",
      targetEmail: target.email,
      targetUserId: userId
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
