"use client";

import { useState } from "react";
import { AiCreditsPaymentPanel, type AiCreditBalance } from "@/components/ai-credits-payment-panel";
import { ChangeTelegramBotTokenButton } from "@/components/change-telegram-bot-token-button";
import { ClaudeAuthReconnectButton } from "@/components/claude-auth-reconnect-button";
import { DestroyWorkspaceButton } from "@/components/destroy-workspace-button";
import { SettingsIntegrations } from "@/components/settings-integrations";
import { SettingsProfileForm } from "@/components/settings-profile-form";
import { SettingsTabs, type SettingsTabId } from "@/components/settings-tabs";
import { SettingsTokenUsageCard } from "@/components/settings-token-usage-card";

type SettingsPageTabsProps = {
  billingConfigured: boolean;
  initialGoogleWorkspaceEnabled: boolean;
  initialProfileName: string;
  initialTab?: SettingsTabId;
  isAdmin: boolean;
  packageTokens: number;
  packageUsdCents: number;
  promptGoogleWorkspaceAuth: boolean;
  tokenQuota: number;
  tokenUsed: number;
  userEmail: string | null;
};

export function SettingsPageTabs({
  billingConfigured,
  initialGoogleWorkspaceEnabled,
  initialProfileName,
  initialTab,
  isAdmin,
  packageTokens,
  packageUsdCents,
  promptGoogleWorkspaceAuth,
  tokenQuota,
  tokenUsed,
  userEmail
}: SettingsPageTabsProps) {
  const [balance, setBalance] = useState<AiCreditBalance>({
    quota: tokenQuota,
    used: tokenUsed
  });
  const isCreditLocked = !isAdmin && balance.quota - balance.used <= 0;
  const disabledSettingsTabs: SettingsTabId[] =
    isCreditLocked && !promptGoogleWorkspaceAuth ? ["integrations"] : [];

  return (
    <SettingsTabs
      disabledReason="Add AI credits or destroy this instance to continue."
      disabledTabs={disabledSettingsTabs}
      general={
        <div className="settings-grid settings-grid--general">
          <SettingsProfileForm
            disabled={isCreditLocked}
            initialProfileName={initialProfileName}
            userEmail={userEmail}
          />

          <SettingsTokenUsageCard
            isAdmin={isAdmin}
            tokenQuota={balance.quota}
            tokenUsed={balance.used}
          />

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
      initialTab={
        disabledSettingsTabs.length > 0
          ? (initialTab === "general" ? "general" : "payment")
          : initialTab
      }
      integrations={
        <div className="settings-grid settings-grid--integrations">
          <SettingsIntegrations
            initialGoogleWorkspaceAuthPrompt={promptGoogleWorkspaceAuth}
            initialGoogleWorkspaceEnabled={initialGoogleWorkspaceEnabled}
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
            balance={balance}
            billingConfigured={billingConfigured}
            initialQuota={tokenQuota}
            initialUsed={tokenUsed}
            onBalanceChange={setBalance}
            packageTokens={packageTokens}
            packageUsdCents={packageUsdCents}
          />
        </div>
      }
    />
  );
}
