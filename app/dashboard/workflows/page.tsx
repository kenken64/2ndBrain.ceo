import { Localized } from "@/components/language-provider";
import { redirect } from "next/navigation";
import { AnnouncementPill } from "@/components/announcement-pill";
import { Atmosphere } from "@/components/atmosphere";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { MyWorkflows } from "@/components/my-workflows";
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

export default async function MyWorkflowsPage() {
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
    redirect("/login?next=/dashboard/workflows");
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
    redirect(onboardingPath("/dashboard/workflows"));
  }

  const email = typeof claimsData.claims.email === "string" ? claimsData.claims.email : null;
  const showAdmin = await canShowAdminWorkspaceLink({ email, userId });
  const onboardingProfile = profile as OnboardingProfile | null;
  const ownerName = onboardingProfile?.owner_name?.trim();
  const avatarName = onboardingProfile?.avatar_name?.trim();

  return (
    <>
      <Atmosphere />
      <div className="dashboard-layout">
        <DashboardSidebar
          activeItem="workflows"
          avatarName={avatarName}
          email={email}
          ownerName={ownerName}
          showAdmin={showAdmin}
        />
        <main className="dashboard-main">
          <div className="dashboard-topbar">
            <AnnouncementPill><Localized en="My Workflows" zh="我的工作流" /></AnnouncementPill>
            <a className="btn-primary" href="/dashboard/marketplace">
              <Localized en="Marketplace" zh="应用市场" />
            </a>
          </div>
          <section className="dashboard-workbench workflow-workbench" aria-labelledby="my-workflows-title">
            <div className="settings-workbench__header">
              <p className="workspace-status-card__eyebrow"><Localized en="Workflow" zh="工作流" /></p>
              <h1 id="my-workflows-title"><Localized en="My Workflows" zh="我的工作流" /></h1>
              <p><Localized en="Manage workflow tools installed from Marketplace and review their AI credit allocations." zh="管理从应用市场安装的工作流工具并查看其 AI 积分分配。" /></p>
            </div>

            <MyWorkflows />
          </section>
        </main>
      </div>
    </>
  );
}
