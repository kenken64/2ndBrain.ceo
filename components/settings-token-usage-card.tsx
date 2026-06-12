"use client";

import { Coins } from "lucide-react";

type SettingsTokenUsageCardProps = {
  isAdmin?: boolean;
  tokenQuota: number;
  tokenUsed: number;
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

export function SettingsTokenUsageCard({
  isAdmin = false,
  tokenQuota,
  tokenUsed
}: SettingsTokenUsageCardProps) {
  const granted = normalizeTokenValue(tokenQuota);
  const used = normalizeTokenValue(tokenUsed);
  const remaining = Math.max(0, granted - used);
  const usagePercent = granted > 0 ? Math.min(100, Math.round((used / granted) * 100)) : 0;
  const statusCopy = isAdmin ? "Quota exempt" : `${usagePercent}% used`;

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
            {isAdmin
              ? "Admin accounts are quota-exempt; stored credits are still shown for transfers."
              : "Granted tokens, consumed usage, and remaining balance for this account."}
          </p>
        </div>
        <span className="settings-toggle-card__status">{statusCopy}</span>
      </div>

      <dl className="settings-token-usage-card__metrics">
        <div>
          <dt>Granted</dt>
          <dd>{formatInteger(granted)}</dd>
        </div>
        <div>
          <dt>Used</dt>
          <dd>{formatInteger(used)}</dd>
        </div>
        <div>
          <dt>Remaining</dt>
          <dd>{formatInteger(remaining)}</dd>
        </div>
      </dl>

      <div
        aria-label={`${usagePercent}% of granted tokens used`}
        className="settings-token-usage-card__bar"
        role="img"
      >
        <span style={{ width: `${usagePercent}%` }} />
      </div>
    </article>
  );
}
