"use client";

import { Localized, LocalizedMessage, useLanguage } from "@/components/language-provider";


import { useState } from "react";
import { Coins, Pause, Play, RefreshCw } from "lucide-react";

type BalanceState = {
  quota: number;
  used: number;
};

type TokenPauseState = {
  openclawTokensPauseReason: string | null;
  openclawTokensPaused: boolean;
  openclawTokensPausedAt: string | null;
  openclawTokensResumedAt: string | null;
};

type SettingsTokenUsageCardProps = {
  isAdmin?: boolean;
  onPauseChange?: (pause: TokenPauseState, balance?: BalanceState) => void;
  tokensPauseReason?: string | null;
  tokensPaused?: boolean;
  tokensPausedAt?: string | null;
  tokensResumedAt?: string | null;
  tokenQuota: number;
  tokenUsed: number;
};

type PauseResponse = {
  balance?: {
    llmTokenQuota?: number;
    llmTokenUsed?: number;
  };
  pause?: TokenPauseState;
  error?: string;
};

function normalizeTokenValue(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en").format(normalizeTokenValue(value));
}

function formatDateTime(value: string | null | undefined, zh = false) {
  if (!value) {
    return zh ? "未记录" : "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return zh ? "未记录" : "Not recorded";
  }

  return new Intl.DateTimeFormat(zh ? "zh-CN" : "en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

export function SettingsTokenUsageCard({
  isAdmin = false,
  onPauseChange,
  tokensPauseReason = null,
  tokensPaused = false,
  tokensPausedAt = null,
  tokensResumedAt = null,
  tokenQuota,
  tokenUsed
}: SettingsTokenUsageCardProps) {
  const zh = useLanguage().language === "zh";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const granted = normalizeTokenValue(tokenQuota);
  const used = normalizeTokenValue(tokenUsed);
  const remaining = Math.max(0, granted - used);
  const usagePercent = granted > 0 ? Math.min(100, Math.round((used / granted) * 100)) : 0;
  const statusCopy = tokensPaused ? (zh ? "AI 已暂停" : "AI paused") : isAdmin ? (zh ? "免配额" : "Quota exempt") : (zh ? `已使用 ${usagePercent}%` : `${usagePercent}% used`);

  async function setPaused(nextPaused: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/settings/token-usage-pause", {
        body: JSON.stringify({ paused: nextPaused }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "PATCH"
      });
      const payload = (await response.json().catch(() => null)) as PauseResponse | null;

      if (!response.ok || !payload?.pause) {
        throw new Error(payload?.error ?? "AI Agent usage setting could not be updated.");
      }

      const quota = Number(payload.balance?.llmTokenQuota);
      const nextUsed = Number(payload.balance?.llmTokenUsed);

      onPauseChange?.(
        payload.pause,
        Number.isFinite(quota) && Number.isFinite(nextUsed)
          ? {
              quota,
              used: nextUsed
            }
          : undefined
      );
      setMessage(nextPaused ? "AI Agent usage paused." : "AI Agent usage resumed.");
    } catch (pauseError) {
      setError(pauseError instanceof Error ? pauseError.message : "AI Agent usage setting could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="settings-action-card settings-token-usage-card" aria-labelledby="settings-token-usage-title">
      <div className="settings-token-usage-card__header">
        <span className="settings-toggle-card__icon" aria-hidden="true">
          <Coins size={22} strokeWidth={1.8} />
        </span>
        <div>
          <p className="workspace-status-card__eyebrow"><Localized en={"AI credits"} zh={"AI 积分"} /></p>
          <h2 id="settings-token-usage-title"><Localized en={"Token balance"} zh={"Token 余额"} /></h2>
          <p>
            {tokensPaused
              ? <Localized en={"AI Agent usage is paused. Existing AI credits remain unchanged until you resume."} zh={"AI Agent 用量已暂停。恢复之前，现有 AI 积分保持不变。"} />
              : isAdmin
              ? <Localized en={"Admin accounts are quota-exempt; stored credits are still shown for transfers."} zh={"管理员账户免配额；保存的积分仍显示供转移使用。"} />
              : <Localized en={"Granted tokens, consumed usage, and remaining balance for this account."} zh={"此账户获授的 Token、已消耗用量和剩余余额。"} />}
          </p>
        </div>
        <span className="settings-toggle-card__status">{statusCopy}</span>
      </div>

      <dl className="settings-token-usage-card__metrics">
        <div>
          <dt><Localized en={"Available"} zh={"可用"} /></dt>
          <dd>{formatInteger(remaining)}</dd>
        </div>
        <div>
          <dt><Localized en={"Granted"} zh={"已授予"} /></dt>
          <dd>{formatInteger(granted)}</dd>
        </div>
        <div>
          <dt><Localized en={"Used"} zh={"已使用"} /></dt>
          <dd>{formatInteger(used)}</dd>
        </div>
      </dl>

      <div
        aria-label={zh ? `已使用所授予 Token 的 ${usagePercent}%` : `${usagePercent}% of granted tokens used`}
        className="settings-token-usage-card__bar"
        role="img"
      >
        <span style={{ width: `${usagePercent}%` }} />
      </div>

      <dl className="settings-token-usage-card__pause">
        <div>
          <dt><Localized en={"Paused"} zh={"已暂停"} /></dt>
          <dd>{formatDateTime(tokensPausedAt, zh)}</dd>
        </div>
        <div>
          <dt><Localized en={"Resumed"} zh={"已恢复"} /></dt>
          <dd>{formatDateTime(tokensResumedAt, zh)}</dd>
        </div>
        <div>
          <dt><Localized en={"Status"} zh={"状态"} /></dt>
          <dd>{tokensPaused ? tokensPauseReason ?? "Paused" : <Localized en={"Active"} zh={"运行中"} />}</dd>
        </div>
      </dl>

      <div className="settings-token-usage-card__actions">
        <button
          className={tokensPaused ? "btn-primary" : "btn-ghost"}
          disabled={busy}
          onClick={() => setPaused(!tokensPaused)}
          type="button"
        >
          {busy ? (
            <RefreshCw size={16} strokeWidth={1.8} />
          ) : tokensPaused ? (
            <Play size={16} strokeWidth={1.8} />
          ) : (
            <Pause size={16} strokeWidth={1.8} />
          )}
          {busy ? <Localized en={"Updating..."} zh={"正在更新..."} /> : tokensPaused ? <Localized en={"Resume AI usage"} zh={"恢复 AI 用量"} /> : <Localized en={"Pause AI usage"} zh={"暂停 AI 用量"} />}
        </button>
      </div>

      {error ? <p className="form-error" role="alert"><LocalizedMessage text={error} /></p> : null}
      {message ? <p className="form-success" role="status"><LocalizedMessage text={message} /></p> : null}
    </article>
  );
}
