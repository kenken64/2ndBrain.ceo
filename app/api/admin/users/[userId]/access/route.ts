import { NextResponse } from "next/server";
import { getAdminAccess, logAdminAudit } from "@/lib/admin";
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

  if (userId === access.userId) {
    return NextResponse.json({ error: "Admins cannot disable their own account" }, { status: 400 });
  }

  const payload = (await request.json().catch(() => null)) as { disabled?: unknown } | null;
  const disabled = Boolean(payload?.disabled);
  const target = await getAdminTargetProfile(access.adminSupabase, userId);
  const { error } = await access.adminSupabase
    .from("profiles")
    .update({
      admin_disabled: disabled
    })
    .eq("id", userId);

  if (error) {
    await logAdminAudit(access.adminSupabase, {
      action: disabled ? "user_disable" : "user_enable",
      adminEmail: access.email,
      adminUserId: access.userId,
      details: { error: error.message },
      status: "failed",
      targetEmail: target.email,
      targetUserId: userId
    });

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAdminAudit(access.adminSupabase, {
    action: disabled ? "user_disable" : "user_enable",
    adminEmail: access.email,
    adminUserId: access.userId,
    targetEmail: target.email,
    targetUserId: userId
  });

  return NextResponse.json({ ok: true });
}
