"use client";

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

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en", {
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const granted = normalizeTokenValue(tokenQuota);
  const used = normalizeTokenValue(tokenUsed);
  const remaining = Math.max(0, granted - used);
  const usagePercent = granted > 0 ? Math.min(100, Math.round((used / granted) * 100)) : 0;
  const statusCopy = tokensPaused ? "AI paused" : isAdmin ? "Quota exempt" : `${usagePercent}% used`;

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
        throw new Error(payload?.error ?? "OpenClaw AI usage setting could not be updated.");
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
      setMessage(nextPaused ? "OpenClaw AI usage paused." : "OpenClaw AI usage resumed.");
    } catch (pauseError) {
      setError(pauseError instanceof Error ? pauseError.message : "OpenClaw AI usage setting could not be updated.");
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
          <p className="workspace-status-card__eyebrow">AI credits</p>
          <h2 id="settings-token-usage-title">Token balance</h2>
          <p>
            {tokensPaused
              ? "OpenClaw AI usage is paused. Existing AI credits remain unchanged until you resume."
              : isAdmin
              ? "Admin accounts are quota-exempt; stored credits are still shown for transfers."
              : "Granted tokens, consumed usage, and remaining balance for this account."}
          </p>
        </div>
        <span className="settings-toggle-card__status">{statusCopy}</span>
      </div>

      <dl className="settings-token-usage-card__metrics">
        <div>
          <dt>Available</dt>
          <dd>{formatInteger(remaining)}</dd>
        </div>
        <div>
          <dt>Granted</dt>
          <dd>{formatInteger(granted)}</dd>
        </div>
        <div>
          <dt>Used</dt>
          <dd>{formatInteger(used)}</dd>
        </div>
      </dl>

      <div
        aria-label={`${usagePercent}% of granted tokens used`}
        className="settings-token-usage-card__bar"
        role="img"
      >
        <span style={{ width: `${usagePercent}%` }} />
      </div>

      <dl className="settings-token-usage-card__pause">
        <div>
          <dt>Paused</dt>
          <dd>{formatDateTime(tokensPausedAt)}</dd>
        </div>
        <div>
          <dt>Resumed</dt>
          <dd>{formatDateTime(tokensResumedAt)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{tokensPaused ? tokensPauseReason ?? "Paused" : "Active"}</dd>
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
          {busy ? "Updating..." : tokensPaused ? "Resume AI usage" : "Pause AI usage"}
        </button>
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="form-success" role="status">{message}</p> : null}
    </article>
  );
}
