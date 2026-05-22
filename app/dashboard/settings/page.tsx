import { redirect } from "next/navigation";
import { AnnouncementPill } from "@/components/announcement-pill";
import { Atmosphere } from "@/components/atmosphere";
import { ChangeTelegramBotTokenButton } from "@/components/change-telegram-bot-token-button";
import { ClaudeAuthReconnectButton } from "@/components/claude-auth-reconnect-button";
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

type ProfileSettings = OnboardingProfile & {
  google_workspace_enabled: boolean | null;
  profile_name: string | null;
};

type OptionalProfileSettings = Pick<ProfileSettings, "google_workspace_enabled" | "profile_name">;

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
  const onboardingProfile = profile as ProfileSettings | null;
  const ownerName = onboardingProfile?.owner_name?.trim();
  const avatarName = onboardingProfile?.avatar_name?.trim();
  const { data: settingsProfile } = userId
    ? await supabase
        .from("profiles")
        .select("profile_name,google_workspace_enabled")
        .eq("id", userId)
        .maybeSingle()
    : { data: null };
  const optionalSettings = settingsProfile as OptionalProfileSettings | null;
  const profileName = optionalSettings?.profile_name?.trim() || ownerName || "";

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
              <SettingsIntegrations
                initialGoogleWorkspaceEnabled={Boolean(optionalSettings?.google_workspace_enabled)}
                initialProfileName={profileName}
              />

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

              <article className="settings-action-card">
                <div>
                  <p className="workspace-status-card__eyebrow">Claude Code auth</p>
                  <h2>Reconnect Claude on OpenClaw</h2>
                  <p>
                    Start the Claude sign-in flow on the OpenClaw instance, open the returned login URL, and poll until Claude Code auth is restored.
                  </p>
                </div>
                <ClaudeAuthReconnectButton />
              </article>

              <article className="settings-action-card settings-action-card--danger">
                <div>
                  <p className="workspace-status-card__eyebrow">Danger zone</p>
                  <h2>Destroy workspace</h2>
                  <p>
                    Destroy the Lightsail OpenClaw instance, clear generated Nth Brain project history, reset onboarding, and log out.
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
