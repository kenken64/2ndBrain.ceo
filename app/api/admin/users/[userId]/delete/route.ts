import { NextResponse } from "next/server";
import { getAdminAccess, logAdminAudit } from "@/lib/admin";
import { destroyUserWorkspaceForAdmin, getAdminTargetProfile } from "@/lib/admin-workspace";

export const runtime = "nodejs";
export const maxDuration = 900;

type AdminUserRouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

export async function POST(_request: Request, context: AdminUserRouteContext) {
  const access = await getAdminAccess();

  if (!access.ok) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }

  if (!access.adminSupabase) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required" }, { status: 503 });
  }

  const { userId } = await context.params;

  if (userId === access.userId) {
    return NextResponse.json({ error: "Admins cannot delete their own account" }, { status: 400 });
  }

  const target = await getAdminTargetProfile(access.adminSupabase, userId);

  try {
    const result = await destroyUserWorkspaceForAdmin(access.adminSupabase, target);

    // targetUserId is deliberately null: the auth user no longer exists, and
    // admin_audit_events.target_user_id has a foreign key back to it. Passing
    // the id here would fail the insert — silently, since logAdminAudit does
    // not surface insert errors — and lose the record of the deletion.
    // target_email carries the identity instead.
    await logAdminAudit(access.adminSupabase, {
      action: "user_workspace_delete",
      adminEmail: access.email,
      adminUserId: access.userId,
      details: {
        avatarsDeleted: result.avatarsDeleted,
        deletedUserId: userId,
        destroyOutputLength: result.destroyOutput?.length ?? 0,
        hadInstance: Boolean(target.openclaw_instance)
      },
      targetEmail: target.email,
      targetUserId: null
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "admin_user_delete_failed";

    await logAdminAudit(access.adminSupabase, {
      action: "user_workspace_delete",
      adminEmail: access.email,
      adminUserId: access.userId,
      details: {
        error: message,
        hadInstance: Boolean(target.openclaw_instance)
      },
      status: "failed",
      targetEmail: target.email,
      targetUserId: userId
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
