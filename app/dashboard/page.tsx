import { redirect } from "next/navigation";
import { AnnouncementPill } from "@/components/announcement-pill";
import { Atmosphere } from "@/components/atmosphere";
import { ChatInput } from "@/components/chat-input";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { SetupCallout } from "@/components/setup-callout";
import { TemplatesPanel } from "@/components/templates-panel";
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
  created_at: string;
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
  const avatarName = (profile as OnboardingProfile | null)?.avatar_name?.trim();
  const firstName = avatarName ?? email?.split("@")[0] ?? "there";
  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id,title,prompt,created_at")
    .order("created_at", { ascending: false })
    .limit(6);

  return (
    <>
      <Atmosphere />
      <div className="dashboard-layout">
        <DashboardSidebar avatarName={avatarName} email={email} />
        <main className="dashboard-main">
          <div className="dashboard-topbar">
            <AnnouncementPill>Telegram bot connected</AnnouncementPill>
            <a className="btn-primary" href="/auth/logout">
              Sign out
            </a>
          </div>
          <section className="dashboard-center">
            <h1 className="dashboard-heading">Ready to build, {firstName}?</h1>
            <p className="dashboard-copy">
              Ask for a project, dashboard, SOP, or operating ritual. The backend stores
              authenticated prompts in Supabase with row level security.
            </p>
            <ChatInput
              className="dashboard-chat"
              placeholder="Ask 2ndBrain to make a document that turns my meeting notes into decisions..."
            />
            <section className="projects-section" aria-labelledby="projects-title">
              <div className="projects-section__header">
                <h2 id="projects-title">Recent projects</h2>
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
                      <h3>{project.title}</h3>
                      <p>{project.prompt}</p>
                      <time dateTime={project.created_at}>{formatProjectDate(project.created_at)}</time>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    No projects yet. Start with the prompt box above.
                  </div>
                )}
              </div>
            </section>
          </section>
          <section className="section">
            <TemplatesPanel />
          </section>
        </main>
      </div>
    </>
  );
}
