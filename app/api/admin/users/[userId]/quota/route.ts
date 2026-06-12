import { NextResponse } from "next/server";
import { getAdminAccess, isAdminUser, logAdminAudit } from "@/lib/admin";
import { getAdminTargetProfile } from "@/lib/admin-workspace";

export const runtime = "nodejs";

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
  const payload = (await request.json().catch(() => null)) as { quota?: unknown } | null;
  const quota = Number(payload?.quota);

  if (!Number.isInteger(quota) || quota < 0) {
    return NextResponse.json({ error: "Token quota must be a non-negative integer" }, { status: 400 });
  }

  const target = await getAdminTargetProfile(access.adminSupabase, userId);

  if (await isAdminUser(target.email, userId)) {
    return NextResponse.json({ error: "Admin accounts are exempt from token quotas." }, { status: 409 });
  }

  const { error } = await access.adminSupabase
    .from("profiles")
    .update({
      llm_token_quota: quota
    })
    .eq("id", userId);

  if (error) {
    await logAdminAudit(access.adminSupabase, {
      action: "llm_token_quota_update",
      adminEmail: access.email,
      adminUserId: access.userId,
      details: { error: error.message, quota },
      status: "failed",
      targetEmail: target.email,
      targetUserId: userId
    });

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAdminAudit(access.adminSupabase, {
    action: "llm_token_quota_update",
    adminEmail: access.email,
    adminUserId: access.userId,
    details: { quota },
    targetEmail: target.email,
    targetUserId: userId
  });

  return NextResponse.json({ ok: true });
}
