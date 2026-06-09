import { redirect } from "next/navigation";
import { AnnouncementPill } from "@/components/announcement-pill";
import { AiCreditsPaymentPanel } from "@/components/ai-credits-payment-panel";
import { Atmosphere } from "@/components/atmosphere";
import { ChangeTelegramBotTokenButton } from "@/components/change-telegram-bot-token-button";
import { ClaudeAuthReconnectButton } from "@/components/claude-auth-reconnect-button";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { DestroyWorkspaceButton } from "@/components/destroy-workspace-button";
import { SetupCallout } from "@/components/setup-callout";
import { SettingsIntegrations } from "@/components/settings-integrations";
import { SettingsProfileForm } from "@/components/settings-profile-form";
import { SettingsTabs } from "@/components/settings-tabs";
import { canShowAdminWorkspaceLink } from "@/lib/admin";
import { hasSupabaseEnv } from "@/lib/env";
import {
  getUserIdFromClaims,
  isOnboardingComplete,
  onboardingPath,
  onboardingProfileSelect,
  type OnboardingProfile
} from "@/lib/onboarding";
import {
  AI_CREDIT_PACKAGE_TOKENS,
  AI_CREDIT_PACKAGE_USD_CENTS,
  hasSolanaBillingEnv
} from "@/lib/solana-billing";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ProfileSettings = OnboardingProfile & {
  google_workspace_enabled: boolean | null;
  profile_name: string | null;
};

type OptionalProfileSettings = Pick<ProfileSettings, "google_workspace_enabled" | "profile_name">;

type BillingProfileSettings = OptionalProfileSettings & {
  llm_token_quota: number | null;
  llm_token_used: number | null;
};

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
  const showAdmin = await canShowAdminWorkspaceLink({ email, userId });
  const onboardingProfile = profile as ProfileSettings | null;
  const ownerName = onboardingProfile?.owner_name?.trim();
  const avatarName = onboardingProfile?.avatar_name?.trim();
  const { data: settingsProfile } = userId
    ? await supabase
        .from("profiles")
        .select("profile_name,google_workspace_enabled,llm_token_quota,llm_token_used")
        .eq("id", userId)
        .maybeSingle()
    : { data: null };
  const optionalSettings = settingsProfile as BillingProfileSettings | null;
  const profileName = optionalSettings?.profile_name?.trim() || ownerName || "";

  return (
    <>
      <Atmosphere />
      <div className="dashboard-layout">
        <DashboardSidebar activeItem="settings" avatarName={avatarName} email={email} ownerName={ownerName} showAdmin={showAdmin} />
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

            <SettingsTabs
              general={
                <div className="settings-grid settings-grid--general">
                  <SettingsProfileForm initialProfileName={profileName} userEmail={email} />

                  <article className="settings-action-card settings-action-card--danger">
                    <div>
                      <p className="workspace-status-card__eyebrow">Danger zone</p>
                      <h2>Destroy instance</h2>
                      <p>
                        Destroy the Lightsail OpenClaw instance, clear generated Nth Brain project history, reset onboarding, and log out.
                      </p>
                    </div>
                    <DestroyWorkspaceButton variant="panel" />
                  </article>
                </div>
              }
              integrations={
                <div className="settings-grid settings-grid--integrations">
                  <SettingsIntegrations
                    initialGoogleWorkspaceEnabled={Boolean(optionalSettings?.google_workspace_enabled)}
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
                </div>
              }
              payment={
                <div className="settings-grid settings-grid--payment">
                  <AiCreditsPaymentPanel
                    billingConfigured={hasSolanaBillingEnv()}
                    initialQuota={Number(optionalSettings?.llm_token_quota ?? 0)}
                    initialUsed={Number(optionalSettings?.llm_token_used ?? 0)}
                    packageTokens={AI_CREDIT_PACKAGE_TOKENS}
                    packageUsdCents={AI_CREDIT_PACKAGE_USD_CENTS}
                  />
                </div>
              }
            />
          </section>
        </main>
      </div>
    </>
  );
}
