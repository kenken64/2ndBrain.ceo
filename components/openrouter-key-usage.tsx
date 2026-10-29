import { Localized, LocalizedMessage } from "@/components/language-provider";
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
          <h2><Localized en={"Chat API key spending"} zh={"对话 API 密钥支出"} /></h2>
          <p><LocalizedMessage text={summary(usage)} /></p>
        </div>
        <span className="settings-toggle-card__status"><Localized en={statusLabel(usage)} zh={usage.status === "unconfigured" ? "未配置" : usage.status === "unavailable" ? "不可用" : usage.remainingUsd === null ? "无上限" : `剩余 ${formatUsd(usage.remainingUsd)}`} /></span>
      </div>

      {usage.status === "ok" ? (
        <div className="solana-payment-history__table">
          <div className="solana-payment-history__head" role="row">
            <span><Localized en={"Key"} zh={"密钥"} /></span>
            <span><Localized en={"Limit"} zh={"上限"} /></span>
            <span><Localized en={"Used"} zh={"已使用"} /></span>
            <span><Localized en={"Remaining"} zh={"剩余"} /></span>
          </div>
          <div className="solana-payment-history__row" role="row">
            <div>
              <strong><Localized en="This key’s spending cap" zh="此密钥的支出上限" /></strong>
              <span>{usage.label ?? "OPENROUTER_API_KEY"}</span>
            </div>
            <div>
              <strong>{usage.limitUsd === null ? <Localized en={"No cap"} zh={"无上限"} /> : formatUsd(usage.limitUsd)}</strong>
              <span>{usage.limitReset ? <Localized en={`Resets ${usage.limitReset}`} zh={`重置周期：${usage.limitReset}`} /> : <Localized en={"Does not reset"} zh={"不重置"} />}</span>
            </div>
            <div>
              <strong>{formatUsd(usage.usedUsd)}</strong>
              <span>
                {usage.limitUsd ? <Localized en={`${Math.round((usage.usedUsd / usage.limitUsd) * 100)}% of cap`} zh={`已使用上限的 ${Math.round((usage.usedUsd / usage.limitUsd) * 100)}%`} /> : <Localized en={"Lifetime usage"} zh={"累计用量"} />}
              </span>
            </div>
            <div>
              <strong>{usage.remainingUsd === null ? <Localized en={"Unlimited"} zh={"无限"} /> : formatUsd(usage.remainingUsd)}</strong>
              <span>{usage.remainingUsd === null ? <Localized en={"No per-key limit"} zh={"无单密钥限制"} /> : <Localized en={"Before chat stops"} zh={"对话停止前"} />}</span>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
