import { LanguageToggle, Localized, LocalizedMessage } from "@/components/language-provider";
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

function formatProjectDate(value: string, locale = "en") {
  return new Intl.DateTimeFormat(locale, {
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
            <AnnouncementPill><Localized en="Workspace is provisioned" zh="工作空间已配置" /></AnnouncementPill>
            <div className="dashboard-topbar__actions">
              <LanguageToggle />
              <a className="btn-primary" href="/auth/logout">
                <Localized en="Log out" zh="退出登录" />
              </a>
            </div>
          </div>
          <section className="dashboard-center">
            <h1 className="dashboard-heading"><Localized en={`${firstName}’s AI CUBER workspace`} zh={`${firstName}的 AI CUBER 工作空间`} /></h1>
            <p className="dashboard-copy">
              <Localized en="Launch AI Agent, review the Remotion AI Assistant setup, and decide how the Nth Brain should be delivered from one dashboard shell." zh="在同一工作空间中启动 AI Agent、查看 Remotion AI 助手设置，并选择 Nth Brain 的交付方式。" />
            </p>
            <div className="workspace-status-grid">
              <OpenClawGatewayStatus initialGatewayUrl={openclawGatewayUrl} instance={openclawInstance} />

              <RemotionAvatarStatus avatarName={avatarName} initialRemotionUrl={remotionUrl} />

              <article className="workspace-status-card" id="llm-wiki">
                <div className="workspace-status-card__header">
                  <div>
                    <p className="workspace-status-card__eyebrow">Nth Brain</p>
                    <h2><Localized en="Markdown workspace and graph" zh="Markdown 工作空间和图谱" /></h2>
                  </div>
                  <span className="project-status project-status--running"><Localized en="foundation ready" zh="基础已就绪" /></span>
                </div>
                <p className="workspace-status-card__copy">
                  <Localized en="Generate and edit project-specific Nth Brain markdown, then index linked pages into the knowledge graph." zh="生成和编辑项目专属的 Nth Brain Markdown，然后将关联页面索引到知识图谱。" />
                </p>
                <div className="wiki-decision-grid">
                  <div className="wiki-decision-card">
                    <strong><Localized en="Hosted Nth Brain" zh="托管的 Nth Brain" /></strong>
                    <span><Localized en="Best for continuous access from the workspace, direct navigation, and future collaboration." zh="适合在工作空间中持续访问、直接导航和未来协作。" /></span>
                  </div>
                  <div className="wiki-decision-card">
                    <strong><Localized en="Downloadable Nth Brain" zh="可下载的 Nth Brain" /></strong>
                    <span><Localized en="Best for portability, backup, and sharing generated project bundles outside the app." zh="适合迁移、备份以及在应用外分享生成的项目包。" /></span>
                  </div>
                </div>
                <div className="workspace-status-actions">
                  <a className="btn-primary" href="/dashboard/wiki">
                    <Localized en="Open Nth Brain" zh="打开 Nth Brain" /> <span className="arrow">-&gt;</span>
                  </a>
                  <a className="text-link" href="/dashboard/graph">
                    <Localized en="Knowledge graph →" zh="知识图谱 →" />
                  </a>
                </div>
              </article>
            </div>

            <section className="projects-section" aria-labelledby="projects-title">
              <div className="projects-section__header">
                <h2 id="projects-title"><Localized en="Recent Nth Brain jobs" zh="最近的 Nth Brain 任务" /></h2>
                <a className="text-link" href="/api/projects">
                  API JSON -&gt;
                </a>
              </div>
              <div className="projects-grid">
                {projectsError ? (
                  <div className="empty-state">
                    <Localized en={<>Run the SQL migration in <code>supabase/migrations</code> to enable projects.</>} zh={<>请运行 <code>supabase/migrations</code> 中的 SQL 迁移以启用项目。</>} />
                  </div>
                ) : projects && projects.length > 0 ? (
                  (projects as Project[]).map((project) => (
                    <article className="project-card" key={project.id}>
                      <span className={`project-status project-status--${project.status}`}>
                        <LocalizedMessage text={project.status} />
                      </span>
                      <h3>{project.title}</h3>
                      <p className="project-card__preview">{project.prompt}</p>
                      <div className="project-card__meta">
                        <span>{project.openclaw_project_slug ?? "Slug pending"}</span>
                        <time dateTime={project.created_at}><Localized en={formatProjectDate(project.created_at)} zh={formatProjectDate(project.created_at, "zh-CN")} /></time>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    <Localized en="No Nth Brain jobs yet. Your hosted versus download decision can stay open while projects start accumulating here." zh="暂无 Nth Brain 任务。创建项目后，任务将显示在这里。" />
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
