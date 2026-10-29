"use client";

import { Localized } from "@/components/language-provider";


import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AiCreditsPaymentPanel, type AiCreditBalance } from "@/components/ai-credits-payment-panel";
import { ChangeTelegramBotTokenButton } from "@/components/change-telegram-bot-token-button";
import { ClaudeAuthReconnectButton } from "@/components/claude-auth-reconnect-button";
import { DestroyWorkspaceButton } from "@/components/destroy-workspace-button";
import { OpenClawInstancesPanel } from "@/components/openclaw-instances-panel";
import { SettingsIntegrations } from "@/components/settings-integrations";
import { SettingsProfileForm } from "@/components/settings-profile-form";
import { SettingsTabs, type SettingsTabId } from "@/components/settings-tabs";
import { SettingsTokenUsageCard } from "@/components/settings-token-usage-card";
import type { SolanaPaymentHistoryItem } from "@/types/solana-payment-history";

type SettingsPageTabsProps = {
  billingConfigured: boolean;
  initialGoogleWorkspaceEnabled: boolean;
  initialProfileName: string;
  initialTab?: SettingsTabId;
  isAdmin: boolean;
  packageTokens: number;
  packageUsdCents: number;
  promptGoogleWorkspaceAuth: boolean;
  solanaPaymentHistory: SolanaPaymentHistoryItem[];
  tokensPauseReason: string | null;
  tokensPaused: boolean;
  tokensPausedAt: string | null;
  tokensResumedAt: string | null;
  tokenQuota: number;
  tokenUsed: number;
  userEmail: string | null;
};

type TokenBalanceResponse = {
  balance?: {
    llmTokenQuota?: number;
    llmTokenUsed?: number;
  };
  pause?: TokenPauseState;
};

type TokenPauseState = {
  openclawTokensPauseReason: string | null;
  openclawTokensPaused: boolean;
  openclawTokensPausedAt: string | null;
  openclawTokensResumedAt: string | null;
};

function readTokenState(payload: TokenBalanceResponse | null) {
  const quota = Number(payload?.balance?.llmTokenQuota);
  const used = Number(payload?.balance?.llmTokenUsed);

  if (!Number.isFinite(quota) || !Number.isFinite(used)) {
    return null;
  }

  return {
    balance: {
      quota,
      used
    },
    pause: payload?.pause
      ? {
          openclawTokensPauseReason: payload.pause.openclawTokensPauseReason ?? null,
          openclawTokensPaused: Boolean(payload.pause.openclawTokensPaused),
          openclawTokensPausedAt: payload.pause.openclawTokensPausedAt ?? null,
          openclawTokensResumedAt: payload.pause.openclawTokensResumedAt ?? null
        }
      : null
  };
}

export function SettingsPageTabs({
  billingConfigured,
  initialGoogleWorkspaceEnabled,
  initialProfileName,
  initialTab,
  isAdmin,
  packageTokens,
  packageUsdCents,
  promptGoogleWorkspaceAuth,
  solanaPaymentHistory,
  tokensPauseReason,
  tokensPaused,
  tokensPausedAt,
  tokensResumedAt,
  tokenQuota,
  tokenUsed,
  userEmail
}: SettingsPageTabsProps) {
  const router = useRouter();
  const [balance, setBalance] = useState<AiCreditBalance>({
    quota: tokenQuota,
    used: tokenUsed
  });
  const [pause, setPause] = useState<TokenPauseState>({
    openclawTokensPauseReason: tokensPauseReason,
    openclawTokensPaused: tokensPaused,
    openclawTokensPausedAt: tokensPausedAt,
    openclawTokensResumedAt: tokensResumedAt
  });
  const refreshBalance = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/token-balance", {
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json().catch(() => null)) as TokenBalanceResponse | null;
      const nextTokenState = readTokenState(payload);

      if (nextTokenState) {
        setBalance(nextTokenState.balance);

        if (nextTokenState.pause) {
          setPause(nextTokenState.pause);
        }
      }
    } catch {
      // Keep the last rendered balance if the background refresh fails.
    }
  }, []);
  const isCreditLocked = !isAdmin && balance.quota - balance.used <= 0;
  const disabledSettingsTabs: SettingsTabId[] =
    isCreditLocked && !promptGoogleWorkspaceAuth ? ["integrations"] : [];

  useEffect(() => {
    void refreshBalance();

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        void refreshBalance();
      }
    }

    window.addEventListener("focus", refreshBalance);
    window.addEventListener("pageshow", refreshBalance);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.removeEventListener("focus", refreshBalance);
      window.removeEventListener("pageshow", refreshBalance);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshBalance]);

  return (
    <SettingsTabs
      disabledReason="Add AI credits or destroy this instance to continue."
      disabledTabs={disabledSettingsTabs}
      general={
        <div className="settings-general-stack">
          <div className="settings-grid settings-grid--general">
            <SettingsProfileForm
              disabled={isCreditLocked}
              initialProfileName={initialProfileName}
              userEmail={userEmail}
            />

            <SettingsTokenUsageCard
              isAdmin={isAdmin}
              onPauseChange={(nextPause, nextBalance) => {
                setPause(nextPause);

                if (nextBalance) {
                  setBalance(nextBalance);
                }
              }}
              tokensPauseReason={pause.openclawTokensPauseReason}
              tokensPaused={pause.openclawTokensPaused}
              tokensPausedAt={pause.openclawTokensPausedAt}
              tokensResumedAt={pause.openclawTokensResumedAt}
              tokenQuota={balance.quota}
              tokenUsed={balance.used}
            />

            <article className="settings-action-card settings-action-card--danger">
              <div>
                <p className="workspace-status-card__eyebrow"><Localized en={"Danger zone"} zh={"危险操作"} /></p>
                <h2><Localized en={"Destroy instance"} zh={"销毁实例"} /></h2>
                <p>
                  <Localized en={"Destroy the Cloud AI Agent instance, clear generated Nth Brain project history, reset onboarding, and log out."} zh={"销毁云端 AI Agent 实例、清除生成的 Nth Brain 项目记录、重置设置流程并退出登录。"} /></p>
              </div>
              <DestroyWorkspaceButton variant="panel" />
            </article>
          </div>

          <OpenClawInstancesPanel />
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
              <p className="workspace-status-card__eyebrow"><Localized en={"Telegram bot"} zh={"Telegram 机器人"} /></p>
              <h2><Localized en={"Reconfigure Telegram bot"} zh={"重新配置 Telegram 机器人"} /></h2>
              <p>
                <Localized en={"Update the Telegram bot token on the current AI Agent instance and restart the pairing flow for approval."} zh={"更新当前 AI Agent 实例上的 Telegram 机器人令牌，并重新启动配对审批流程。"} /></p>
            </div>
            <ChangeTelegramBotTokenButton variant="panel" />
          </article>

          <article className="settings-action-card">
            <div>
              <p className="workspace-status-card__eyebrow"><Localized en={"Claude Code auth"} zh={"Claude Code 授权"} /></p>
              <h2><Localized en={"Reconnect Claude on AI Agent"} zh={"在 AI Agent 上重新连接 Claude"} /></h2>
              <p>
                <Localized en={"Start the Claude sign-in flow on the AI Agent instance, open the returned login URL, and poll until Claude Code auth is restored."} zh={"在 AI Agent 实例上启动 Claude 登录流程，打开返回的登录地址，并持续检查直到 Claude Code 授权恢复。"} /></p>
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
            onPaymentConfirmed={() => router.refresh()}
            packageTokens={packageTokens}
            packageUsdCents={packageUsdCents}
            paymentHistory={solanaPaymentHistory}
          />
        </div>
      }
    />
  );
}
