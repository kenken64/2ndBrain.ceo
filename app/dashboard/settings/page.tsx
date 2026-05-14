import { redirect } from "next/navigation";
import { AnnouncementPill } from "@/components/announcement-pill";
import { Atmosphere } from "@/components/atmosphere";
import { ChangeTelegramBotTokenButton } from "@/components/change-telegram-bot-token-button";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { DestroyWorkspaceButton } from "@/components/destroy-workspace-button";
import { SetupCallout } from "@/components/setup-callout";
import { SettingsIntegrations } from "@/components/settings-integrations";
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

export default async function DashboardSettingsPage() {
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
    redirect("/login?next=/dashboard/settings");
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
    redirect(onboardingPath("/dashboard/settings"));
  }

  const email = typeof claimsData.claims.email === "string" ? claimsData.claims.email : null;
  const onboardingProfile = profile as OnboardingProfile | null;
  const ownerName = onboardingProfile?.owner_name?.trim();
  const avatarName = onboardingProfile?.avatar_name?.trim();

  return (
    <>
      <Atmosphere />
      <div className="dashboard-layout">
        <DashboardSidebar activeItem="settings" avatarName={avatarName} email={email} ownerName={ownerName} />
        <main className="dashboard-main">
          <div className="dashboard-topbar">
            <AnnouncementPill>Workspace settings</AnnouncementPill>
            <a className="btn-primary" href="/auth/logout">
              Log out
            </a>
          </div>
          <section className="dashboard-workbench settings-workbench" aria-labelledby="settings-title">
            <div className="settings-workbench__header">
              <p className="workspace-status-card__eyebrow">Admin controls</p>
              <h1 id="settings-title">Workspace settings</h1>
              <p>Manage external integrations and destructive workspace actions from one protected page.</p>
            </div>

            <div className="settings-grid">
              <SettingsIntegrations />

              <article className="settings-action-card">
                <div>
                  <p className="workspace-status-card__eyebrow">Telegram bot</p>
                  <h2>Reconfigure Telegram bot</h2>
                  <p>
                    Update the Telegram bot token on the current OpenClaw instance and restart the pairing flow for approval.
                  </p>
                </div>
                <ChangeTelegramBotTokenButton variant="panel" />
              </article>

              <article className="settings-action-card settings-action-card--danger">
                <div>
                  <p className="workspace-status-card__eyebrow">Danger zone</p>
                  <h2>Destroy workspace</h2>
                  <p>
                    Destroy the Lightsail OpenClaw instance, clear generated wiki/project history, reset onboarding, and log out.
                  </p>
                </div>
                <DestroyWorkspaceButton variant="panel" />
              </article>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}
