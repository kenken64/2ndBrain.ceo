import { redirect } from "next/navigation";
import { AnnouncementPill } from "@/components/announcement-pill";
import { Atmosphere } from "@/components/atmosphere";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { SetupCallout } from "@/components/setup-callout";
import { SettingsPageTabs } from "@/components/settings-page-tabs";
import { type SettingsTabId } from "@/components/settings-tabs";
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
import { getUserSolanaPaymentHistory } from "@/lib/solana-payment-history";
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
  openclaw_tokens_pause_reason: string | null;
  openclaw_tokens_paused: boolean | null;
  openclaw_tokens_paused_at: string | null;
  openclaw_tokens_resumed_at: string | null;
};

type DashboardSettingsPageProps = {
  searchParams?: Promise<{
    gwsAuth?: string;
    next?: string;
    tab?: string;
  }>;
};

function parseSettingsTab(value: string | undefined): SettingsTabId | undefined {
  if (value === "general" || value === "integrations" || value === "payment") {
    return value;
  }

  return undefined;
}

export default async function DashboardSettingsPage({ searchParams }: DashboardSettingsPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const requestedTab = parseSettingsTab(params?.tab);
  const promptGoogleWorkspaceAuth = params?.gwsAuth === "login";

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
        .select("profile_name,google_workspace_enabled,llm_token_quota,llm_token_used,openclaw_tokens_paused,openclaw_tokens_paused_at,openclaw_tokens_resumed_at,openclaw_tokens_pause_reason")
        .eq("id", userId)
        .maybeSingle()
    : { data: null };
  const optionalSettings = settingsProfile as BillingProfileSettings | null;
  const profileName = optionalSettings?.profile_name?.trim() || ownerName || "";
  const llmTokenQuota = Number(optionalSettings?.llm_token_quota ?? 0);
  const llmTokenUsed = Number(optionalSettings?.llm_token_used ?? 0);
  const availableCredits = llmTokenQuota - llmTokenUsed;
  const isCreditLocked = !showAdmin && availableCredits <= 0;
  const solanaPaymentHistory = userId
    ? await getUserSolanaPaymentHistory(supabase, userId, {
        email,
        full_name: ownerName ?? null,
        id: userId
      })
    : [];

  return (
    <>
      <Atmosphere />
      <div className="dashboard-layout">
        <DashboardSidebar
          activeItem="settings"
          avatarName={avatarName}
          creditLocked={isCreditLocked}
          email={email}
          ownerName={ownerName}
          showAdmin={showAdmin}
        />
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

            <SettingsPageTabs
              billingConfigured={hasSolanaBillingEnv()}
              initialGoogleWorkspaceEnabled={Boolean(optionalSettings?.google_workspace_enabled)}
              initialProfileName={profileName}
              initialTab={requestedTab}
              isAdmin={showAdmin}
              packageTokens={AI_CREDIT_PACKAGE_TOKENS}
              packageUsdCents={AI_CREDIT_PACKAGE_USD_CENTS}
              promptGoogleWorkspaceAuth={promptGoogleWorkspaceAuth}
              solanaPaymentHistory={solanaPaymentHistory}
              tokensPauseReason={optionalSettings?.openclaw_tokens_pause_reason ?? null}
              tokensPaused={Boolean(optionalSettings?.openclaw_tokens_paused)}
              tokensPausedAt={optionalSettings?.openclaw_tokens_paused_at ?? null}
              tokensResumedAt={optionalSettings?.openclaw_tokens_resumed_at ?? null}
              tokenQuota={llmTokenQuota}
              tokenUsed={llmTokenUsed}
              userEmail={email}
            />
          </section>
        </main>
      </div>
    </>
  );
}
