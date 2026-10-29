import { LanguageToggle, Localized } from "@/components/language-provider";
import { redirect } from "next/navigation";
import { AnnouncementPill } from "@/components/announcement-pill";
import { Atmosphere } from "@/components/atmosphere";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { SetupCallout } from "@/components/setup-callout";
import { WorkflowMarketplace } from "@/components/workflow-marketplace";
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

export default async function WorkflowMarketplacePage() {
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
    redirect("/login?next=/dashboard/marketplace");
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
    redirect(onboardingPath("/dashboard/marketplace"));
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
          activeItem="marketplace"
          avatarName={avatarName}
          email={email}
          ownerName={ownerName}
          showAdmin={showAdmin}
        />
        <main className="dashboard-main">
          <div className="dashboard-topbar">
            <AnnouncementPill><Localized en="Workflow marketplace" zh="工作流应用市场" /></AnnouncementPill>
            <div className="dashboard-topbar__actions">
              <LanguageToggle />
              <a className="btn-primary" href="/dashboard/workflows">
                <Localized en="My Workflows" zh="我的工作流" />
              </a>
            </div>
          </div>
          <section className="dashboard-workbench workflow-workbench" aria-labelledby="workflow-marketplace-title">
            <div className="settings-workbench__header">
              <p className="workspace-status-card__eyebrow"><Localized en="Workflow" zh="工作流" /></p>
              <h1 id="workflow-marketplace-title"><Localized en="Marketplace" zh="应用市场" /></h1>
              <p><Localized en="Install workflow tools, allocate AI credits to each tool, and keep them available under My Workflows." zh="安装工作流工具、为每个工具分配 AI 积分，并在“我的工作流”中使用。" /></p>
            </div>

            <WorkflowMarketplace />
          </section>
        </main>
      </div>
    </>
  );
}
