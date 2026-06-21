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
            <AnnouncementPill>My Workflows</AnnouncementPill>
            <a className="btn-primary" href="/dashboard/marketplace">
              Marketplace
            </a>
          </div>
          <section className="dashboard-workbench workflow-workbench" aria-labelledby="my-workflows-title">
            <div className="settings-workbench__header">
              <p className="workspace-status-card__eyebrow">Workflow</p>
              <h1 id="my-workflows-title">My Workflows</h1>
              <p>Manage workflow tools installed from Marketplace and review their AI credit allocations.</p>
            </div>

            <MyWorkflows />
          </section>
        </main>
      </div>
    </>
  );
}
