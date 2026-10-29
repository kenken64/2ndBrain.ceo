import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { AnnouncementPill } from "@/components/announcement-pill";
import { Atmosphere } from "@/components/atmosphere";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { LanguageToggle, Localized } from "@/components/language-provider";
import { PomodoroTimer } from "@/components/pomodoro-timer";
import { SetupCallout } from "@/components/setup-callout";
import { canShowAdminWorkspaceLink } from "@/lib/admin";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PomodoroPage() {
  if (!hasSupabaseEnv()) {
    return <><Atmosphere /><main className="auth-page"><SetupCallout /></main></>;
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(claimsData?.claims);
  if (claimsError || !userId) redirect("/login?next=%2Fdashboard%2Fpomodoro");

  const [{ data: profile }, { data: install, error: installError }] = await Promise.all([
    supabase.from("profiles").select("owner_name,avatar_name").eq("id", userId).maybeSingle(),
    supabase.from("marketplace_installs").select("id,status").eq("user_id", userId).eq("item_id", "pomodoro-timer").maybeSingle()
  ]);
  if (installError) throw new Error("pomodoro_install_lookup_failed");
  if (install?.status !== "installed") redirect("/dashboard/marketplace");

  const email = typeof claimsData?.claims?.email === "string" ? claimsData.claims.email : null;
  const showAdmin = await canShowAdminWorkspaceLink({ email, userId });

  return (
    <>
      <Atmosphere />
      <div className="dashboard-layout">
        <DashboardSidebar activeItem="workflows" avatarName={profile?.avatar_name ?? null} email={email} ownerName={profile?.owner_name ?? null} showAdmin={showAdmin} />
        <main className="dashboard-main">
          <div className="dashboard-topbar">
            <AnnouncementPill><Localized en="Pomodoro Timer" zh="番茄钟" /></AnnouncementPill>
            <div className="dashboard-topbar__actions">
              <LanguageToggle />
              <a className="btn-ghost" href="/dashboard/workflows"><ArrowLeft aria-hidden="true" size={16} /><Localized en="My Workflows" zh="我的工作流" /></a>
            </div>
          </div>
          <PomodoroTimer userId={userId} />
        </main>
      </div>
    </>
  );
}
