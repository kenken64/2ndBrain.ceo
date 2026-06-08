import { redirect } from "next/navigation";
import { AnnouncementPill } from "@/components/announcement-pill";
import { Atmosphere } from "@/components/atmosphere";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { OpenClawGatewayStatus } from "@/components/openclaw-gateway-status";
import { RemotionAvatarStatus } from "@/components/remotion-avatar-status";
import { SetupCallout } from "@/components/setup-callout";
import { canShowAdminWorkspaceLink } from "@/lib/admin";
import { hasSupabaseEnv } from "@/lib/env";
import {
  getUserIdFromClaims,
  isOnboardingComplete,
  onboardingPath,
  onboardingProfileSelect,
  type OnboardingProfile
} from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Project = {
  id: string;
  title: string;
  prompt: string;
  status: string;
  created_at: string;
  openclaw_project_slug?: string | null;
};

function formatProjectDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

export default async function DashboardPage() {
  if (!hasSupabaseEnv()) {
    return (
      <>
        <Atmosphere />
        <main className="auth-page">
          <SetupCallout />
        </main>
      </>
    );
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims) {
    redirect("/login?next=/dashboard");
  }

  const userId = getUserIdFromClaims(claimsData.claims);
  const { data: profile } = userId
    ? await supabase
        .from("profiles")
        .select(onboardingProfileSelect)
        .eq("id", userId)
        .maybeSingle()
    : { data: null };

  if (!isOnboardingComplete(profile as OnboardingProfile | null)) {
    redirect(onboardingPath("/dashboard"));
  }

  const email = typeof claimsData.claims.email === "string" ? claimsData.claims.email : null;
  const showAdmin = await canShowAdminWorkspaceLink({ email, userId });
  const onboardingProfile = profile as OnboardingProfile | null;
  const ownerName = onboardingProfile?.owner_name?.trim();
  const avatarName = onboardingProfile?.avatar_name?.trim();
  const openclawInstance = onboardingProfile?.openclaw_instance?.trim() ?? null;
  const openclawGatewayUrl = onboardingProfile?.openclaw_gateway_url?.trim() ?? null;
  const remotionUrl = onboardingProfile?.openclaw_remotion_url?.trim() ?? null;
  const firstName = ownerName ?? email?.split("@")[0] ?? "there";
  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id,title,prompt,status,created_at,openclaw_project_slug")
    .order("created_at", { ascending: false })
    .limit(6);

  return (
    <>
      <Atmosphere />
      <div className="dashboard-layout">
        <DashboardSidebar activeItem="gateway" avatarName={avatarName} email={email} ownerName={ownerName} showAdmin={showAdmin} />
        <main className="dashboard-main">
          <div className="dashboard-topbar">
            <AnnouncementPill>Workspace is provisioned</AnnouncementPill>
            <a className="btn-primary" href="/auth/logout">
              Log out
            </a>
          </div>
          <section className="dashboard-center">
            <h1 className="dashboard-heading">{firstName}&apos;s 2ndBrain workspace</h1>
            <p className="dashboard-copy">
              Launch OpenClaw, review the Remotion AI Assistant setup, and decide how the Nth Brain
              should be delivered from one dashboard shell.
            </p>
            <div className="workspace-status-grid">
              <OpenClawGatewayStatus initialGatewayUrl={openclawGatewayUrl} instance={openclawInstance} />

              <RemotionAvatarStatus avatarName={avatarName} initialRemotionUrl={remotionUrl} />

              <article className="workspace-status-card" id="llm-wiki">
                <div className="workspace-status-card__header">
                  <div>
                    <p className="workspace-status-card__eyebrow">Nth Brain</p>
                    <h2>Markdown workspace and graph</h2>
                  </div>
                  <span className="project-status project-status--running">foundation ready</span>
                </div>
                <p className="workspace-status-card__copy">
                  Generate and edit project-specific Nth Brain markdown, then index linked pages into the knowledge graph.
                </p>
                <div className="wiki-decision-grid">
                  <div className="wiki-decision-card">
                    <strong>Hosted Nth Brain</strong>
                    <span>Best for continuous access from the workspace, direct navigation, and future collaboration.</span>
                  </div>
                  <div className="wiki-decision-card">
                    <strong>Downloadable Nth Brain</strong>
                    <span>Best for portability, backup, and sharing generated project bundles outside the app.</span>
                  </div>
                </div>
                <div className="workspace-status-actions">
                  <a className="btn-primary" href="/dashboard/wiki">
                    Open Nth Brain <span className="arrow">-&gt;</span>
                  </a>
                  <a className="text-link" href="/dashboard/graph">
                    Knowledge graph -&gt;
                  </a>
                </div>
              </article>
            </div>

            <section className="projects-section" aria-labelledby="projects-title">
              <div className="projects-section__header">
                <h2 id="projects-title">Recent Nth Brain jobs</h2>
                <a className="text-link" href="/api/projects">
                  API JSON -&gt;
                </a>
              </div>
              <div className="projects-grid">
                {projectsError ? (
                  <div className="empty-state">
                    Run the SQL migration in <code>supabase/migrations</code> to enable projects.
                  </div>
                ) : projects && projects.length > 0 ? (
                  (projects as Project[]).map((project) => (
                    <article className="project-card" key={project.id}>
                      <span className={`project-status project-status--${project.status}`}>
                        {project.status}
                      </span>
                      <h3>{project.title}</h3>
                      <p className="project-card__preview">{project.prompt}</p>
                      <div className="project-card__meta">
                        <span>{project.openclaw_project_slug ?? "Slug pending"}</span>
                        <time dateTime={project.created_at}>{formatProjectDate(project.created_at)}</time>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    No Nth Brain jobs yet. Your hosted versus download decision can stay open while projects start accumulating here.
                  </div>
                )}
              </div>
            </section>
          </section>
        </main>
      </div>
    </>
  );
}
