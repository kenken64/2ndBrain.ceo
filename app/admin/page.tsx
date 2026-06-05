import { redirect } from "next/navigation";
import { AdminUsersTable, type AdminUserRow } from "@/components/admin-users-table";
import { AnnouncementPill } from "@/components/announcement-pill";
import { Atmosphere } from "@/components/atmosphere";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { requireAdminPage } from "@/lib/admin";

export const dynamic = "force-dynamic";

type ProfileRow = {
  admin_deleted_at: string | null;
  admin_disabled: boolean | null;
  bedrock_token_last4: string | null;
  bedrock_token_updated_at: string | null;
  email: string | null;
  full_name: string | null;
  id: string;
  llm_token_quota: number | null;
  llm_token_used: number | null;
  openclaw_instance: string | null;
  openclaw_instance_created_count: number | null;
  openclaw_provision_status: string | null;
};

type ProjectRow = {
  user_id: string;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function metric(label: string, value: number) {
  return (
    <article className="workspace-card admin-metric-card" key={label}>
      <strong>{formatNumber(value)}</strong>
      <span>{label}</span>
    </article>
  );
}

export default async function AdminPage() {
  const access = await requireAdminPage({
    next: "/admin",
    requireMfa: true,
    requireServiceRole: true
  });

  if (!access.ok) {
    return (
      <>
        <Atmosphere />
        <main className="auth-page">
          <section className="auth-panel">
            <h1>Admin unavailable</h1>
            <p>{access.message}</p>
          </section>
        </main>
      </>
    );
  }

  if (!access.adminSupabase) {
    redirect("/admin/mfa?next=/admin");
  }

  const { data: profileRows } = await access.adminSupabase
    .from("profiles")
    .select(
      "id,email,full_name,admin_disabled,admin_deleted_at,llm_token_quota,llm_token_used,openclaw_instance,openclaw_provision_status,openclaw_instance_created_count,bedrock_token_updated_at,bedrock_token_last4"
    )
    .order("created_at", { ascending: false });
  const { data: projectRows } = await access.adminSupabase.from("projects").select("user_id");
  const profiles = (profileRows ?? []) as ProfileRow[];
  const projects = (projectRows ?? []) as ProjectRow[];
  const projectCounts = new Map<string, number>();

  for (const project of projects) {
    projectCounts.set(project.user_id, (projectCounts.get(project.user_id) ?? 0) + 1);
  }

  const users: AdminUserRow[] = profiles.map((profile) => ({
    adminDeletedAt: profile.admin_deleted_at,
    bedrockTokenLast4: profile.bedrock_token_last4,
    bedrockTokenUpdatedAt: profile.bedrock_token_updated_at,
    disabled: Boolean(profile.admin_disabled || profile.admin_deleted_at),
    email: profile.email,
    fullName: profile.full_name,
    id: profile.id,
    llmTokenQuota: Number(profile.llm_token_quota ?? 0),
    llmTokenUsed: Number(profile.llm_token_used ?? 0),
    openclawInstance: profile.openclaw_instance,
    openclawProvisionStatus: profile.openclaw_provision_status,
    projectCount: projectCounts.get(profile.id) ?? 0
  }));

  const registeredUsers = users.length;
  const activeUsers = users.filter((user) => !user.disabled).length;
  const disabledUsers = users.filter((user) => user.disabled).length;
  const activeInstances = users.filter((user) => user.openclawInstance).length;
  const createdInstances = profiles.reduce(
    (sum, profile) => sum + Number(profile.openclaw_instance_created_count ?? 0),
    0
  );
  const tokensAssigned = users.reduce((sum, user) => sum + user.llmTokenQuota, 0);
  const tokensUsed = users.reduce((sum, user) => sum + user.llmTokenUsed, 0);

  return (
    <>
      <Atmosphere />
      <div className="dashboard-layout">
        <DashboardSidebar activeItem="admin" email={access.email} ownerName="Admin" />
        <main className="dashboard-main">
          <div className="dashboard-topbar">
            <AnnouncementPill>TOTP verified admin</AnnouncementPill>
            <a className="btn-primary" href="/auth/logout">
              Log out
            </a>
          </div>
          <section className="dashboard-workbench admin-workbench" aria-labelledby="admin-title">
            <div className="settings-workbench__header">
              <p className="workspace-status-card__eyebrow">Admin module</p>
              <h1 id="admin-title">2ndBrain administration</h1>
              <p>Assign LLM token quotas, disable access, delete workspace data, and overwrite per-user Bedrock bearer tokens.</p>
            </div>

            <div className="admin-metrics-grid">
              {metric("registered users", registeredUsers)}
              {metric("active users", activeUsers)}
              {metric("disabled or deleted users", disabledUsers)}
              {metric("AI Agent instances created", createdInstances)}
              {metric("active AI Agent instances", activeInstances)}
              {metric("LLM tokens assigned", tokensAssigned)}
              {metric("LLM tokens used", tokensUsed)}
            </div>

            <AdminUsersTable users={users} />
          </section>
        </main>
      </div>
    </>
  );
}
