import { KeyRound } from "lucide-react";
import type { OpenRouterKeyUsage } from "@/lib/openrouter-key-usage";

type OpenRouterKeyUsageCardProps = {
  usage: OpenRouterKeyUsage;
};

function formatUsd(value: number) {
  return new Intl.NumberFormat("en", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency"
  }).format(value);
}

function summary(usage: OpenRouterKeyUsage) {
  if (usage.status === "unconfigured") {
    return "OPENROUTER_API_KEY is not set, so workspace chat is unavailable.";
  }

  if (usage.status === "unavailable") {
    return "OpenRouter did not return usage for the configured key. Try again shortly.";
  }

  return usage.limitUsd === null
    ? "Workspace chat is billed to this key, which has no spending cap."
    : "Workspace chat stops answering once this key's spending cap is used up.";
}

function statusLabel(usage: OpenRouterKeyUsage) {
  if (usage.status === "unconfigured") {
    return "Not configured";
  }

  if (usage.status === "unavailable") {
    return "Unavailable";
  }

  return usage.remainingUsd === null ? "No cap" : `${formatUsd(usage.remainingUsd)} left`;
}

/**
 * Reuses the Solana history table styles, which are presentational rather
 * than Solana-specific.
 */
export function OpenRouterKeyUsageCard({ usage }: OpenRouterKeyUsageCardProps) {
  return (
    <article className="settings-action-card openrouter-key-usage">
      <div className="solana-payment-history__header">
        <span className="settings-toggle-card__icon" aria-hidden="true">
          <KeyRound size={22} strokeWidth={1.8} />
        </span>
        <div>
          <p className="workspace-status-card__eyebrow">OpenRouter</p>
          <h2>Chat API key spending</h2>
          <p>{summary(usage)}</p>
        </div>
        <span className="settings-toggle-card__status">{statusLabel(usage)}</span>
      </div>

      {usage.status === "ok" ? (
        <div className="solana-payment-history__table">
          <div className="solana-payment-history__head" role="row">
            <span>Key</span>
            <span>Limit</span>
            <span>Used</span>
            <span>Remaining</span>
          </div>
          <div className="solana-payment-history__row" role="row">
            <div>
              <strong>This key&apos;s spending cap</strong>
              <span>{usage.label ?? "OPENROUTER_API_KEY"}</span>
            </div>
            <div>
              <strong>{usage.limitUsd === null ? "No cap" : formatUsd(usage.limitUsd)}</strong>
              <span>{usage.limitReset ? `Resets ${usage.limitReset}` : "Does not reset"}</span>
            </div>
            <div>
              <strong>{formatUsd(usage.usedUsd)}</strong>
              <span>
                {usage.limitUsd ? `${Math.round((usage.usedUsd / usage.limitUsd) * 100)}% of cap` : "Lifetime usage"}
              </span>
            </div>
            <div>
              <strong>{usage.remainingUsd === null ? "Unlimited" : formatUsd(usage.remainingUsd)}</strong>
              <span>{usage.remainingUsd === null ? "No per-key limit" : "Before chat stops"}</span>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
