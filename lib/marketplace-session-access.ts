import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { workflowLaunchConfigByToolId } from "@/lib/workflow-launch";
function denied(error: string, status = 403) { return { active: false as const, error, status }; }
function revokedAtSeconds(value: string | null) { const time = value ? Date.parse(value) : NaN; return Number.isFinite(time) ? Math.floor(time/1000) : null; }
type ProfileRow = { admin_deleted_at: string | null; admin_disabled: boolean | null; marketplace_launch_revoked_at: string | null };
type InstallRow = { id: string; item_id: string; status: string };
export async function checkMarketplaceLaunchAccess({userId,installId,toolId,issuedAt}: {userId:string;installId:string;toolId:string;issuedAt:number}) {
  const launchConfig = workflowLaunchConfigByToolId(toolId);

  if (!launchConfig) {
    return denied("Unknown workflow tool.", 400);
  }

  const adminSupabase = createAdminClient();
  const { data: profileRow, error: profileError } = await adminSupabase
    .from("profiles")
    .select("admin_deleted_at,admin_disabled,marketplace_launch_revoked_at")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    return denied("Marketplace access check unavailable.", 503);
  }

  if (!profileRow) {
    return denied("Profile was not found.", 404);
  }

  const profile = profileRow as ProfileRow;

  if (profile.admin_disabled || profile.admin_deleted_at) {
    return denied("Account access is disabled.");
  }

  const revokedSeconds = revokedAtSeconds(profile.marketplace_launch_revoked_at);

  if (revokedSeconds !== null && Math.trunc(issuedAt) <= revokedSeconds) {
    return denied("AI CUBER session has been logged out.");
  }

  const { data: installRow, error: installError } = await adminSupabase
    .from("marketplace_installs")
    .select("id,item_id,status")
    .eq("id", installId)
    .eq("user_id", userId)
    .maybeSingle();

  if (installError) {
    return denied("Marketplace access check unavailable.", 503);
  }

  if (!installRow) {
    return denied("Installed workflow tool was not found.", 404);
  }

  const install = installRow as InstallRow;

  if (install.item_id !== launchConfig.itemId || install.status !== "installed") {
    return denied("Workflow tool is not active.");
  }

  return { active: true as const, status: 200 };
}
