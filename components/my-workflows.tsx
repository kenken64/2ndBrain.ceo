"use client";

import { Localized, useLanguage, LocalizedMessage } from "@/components/language-provider";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, RefreshCw, Rocket, Store, Trash2 } from "lucide-react";
import {
  WORKFLOW_TEMPLATES,
  workflowTemplateById,
  type WorkflowTemplate
} from "@/lib/workflow-templates";

type MarketplaceInstall = {
  allocation: {
    allocatedTokens: number;
    availableTokens: number | null;
    quotaExempt: boolean;
    usedTokens: number;
  } | null;
  chargedTokens: number;
  currentPeriodStartedAt?: string | null;
  disabledAt?: string | null;
  disabledReason?: string | null;
  installedAt?: string | null;
  itemId: string;
  itemType: string;
  lastChargedAt?: string | null;
  nextChargeAt?: string | null;
  priceTokens: number;
  status: string;
  unsubscribedAt?: string | null;
};

type MarketplaceState = {
  balance: { availableTokens: number };
  installs: MarketplaceInstall[];
  isAdmin: boolean;
};

type UnsubscribeResponse = {
  balance: {
    availableTokens: number;
    llmTokenQuota: number;
    llmTokenUsed: number;
  };
  install: MarketplaceInstall & {
    alreadyUnsubscribed?: boolean;
    refundedTokens?: number;
  };
  isAdmin: boolean;
};

type LaunchResponse = {
  launchUrl: string;
};

function formatTokens(value: number | null | undefined, zh = false) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return zh ? "无限" : "Unlimited";
  }

  return new Intl.NumberFormat("en").format(Math.max(0, Math.trunc(value)));
}

function formatDate(value: string | null | undefined, zh = false) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(zh ? "zh-CN" : "en", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

async function readJson<T>(response: Response) {
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Installed workflow tools could not be loaded.");
  }

  if (!payload) {
    throw new Error("Installed workflow tools response was empty.");
  }

  return payload;
}

function workflowFromInstall(install: MarketplaceInstall) {
  const item = workflowTemplateById(install.itemId);

  if (!item) {
    return null;
  }

  return {
    install,
    item
  };
}

export function MyWorkflows({ setupComplete = true }: { setupComplete?: boolean }) {
  const { language } = useLanguage();
  const zh = language === "zh";
  const [installs, setInstalls] = useState<MarketplaceInstall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [canUsePaidTools, setCanUsePaidTools] = useState(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [unsubscribingId, setUnsubscribingId] = useState<string | null>(null);
  const workflows = useMemo(
    () =>
      installs
        .filter((install) => WORKFLOW_TEMPLATES.some((template) => template.id === install.itemId))
        .map(workflowFromInstall)
        .filter((workflow): workflow is { install: MarketplaceInstall; item: WorkflowTemplate } => Boolean(workflow)),
    [installs]
  );
  async function refreshInstalls() {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/marketplace/installs", {
        cache: "no-store"
      });
      const payload = await readJson<MarketplaceState>(response);

      setInstalls(payload.installs);
      setCanUsePaidTools(payload.isAdmin || payload.balance.availableTokens > 0);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Installed workflow tools could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshInstalls();
  }, []);

  async function unsubscribeWorkflow(itemId: string, title: string) {
    const free = workflowTemplateById(itemId)?.priceTokens === 0;
    const confirmed = window.confirm(free
      ? (zh ? `从工作空间移除 ${title}？` : `Remove ${title} from your workspace?`)
      : (zh ? `取消订阅 ${title}？后续定期 AI 积分扣费将停止。` : `Unsubscribe ${title}? Future recurring AI credit charges will stop.`));

    if (!confirmed) {
      return;
    }

    setUnsubscribingId(itemId);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/marketplace/unsubscribe", {
        body: JSON.stringify({ itemId }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const payload = await readJson<UnsubscribeResponse>(response);
      const refundedTokens = payload.install.refundedTokens ?? 0;

      setInstalls((current) => current.filter((install) => install.itemId !== itemId));
      setMessage(
        payload.install.alreadyUnsubscribed
          ? "Workflow tool was already unsubscribed."
          : free
            ? "Free app removed from My Workflows."
          : refundedTokens > 0
            ? `Workflow tool unsubscribed and ${formatTokens(refundedTokens)} AI credits refunded.`
            : "Workflow tool unsubscribed. Future recurring charges are stopped."
      );
    } catch (unsubscribeError) {
      setError(unsubscribeError instanceof Error ? unsubscribeError.message : "Workflow tool could not be unsubscribed.");
    } finally {
      setUnsubscribingId(null);
    }
  }

  async function launchWorkflow(itemId: string) {
    setLaunchingId(itemId);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/marketplace/launch", {
        body: JSON.stringify({ itemId }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const payload = await readJson<LaunchResponse>(response);

      window.open(payload.launchUrl, "_blank", "noopener,noreferrer");
      setLaunchingId(null);
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : "Workflow tool could not be launched.");
      setLaunchingId(null);
    }
  }

  if (!loading && workflows.length === 0) {
    return (
      <article className="workflow-empty">
        <div>
          <p className="workspace-status-card__eyebrow"><Localized en="My Workflows" zh="我的工作流" /></p>
          <h2><Localized en="No workflow tools installed" zh="尚未安装工作流工具" /></h2>
          <p><Localized en="Install workflow tools from Marketplace, then manage their allocations here." zh="从应用市场安装工作流工具，然后在此管理其积分分配。" /></p>
          {error ? <p className="form-error" role="alert"><LocalizedMessage text={error} /></p> : null}
          {message ? <p className="form-success" role="status"><LocalizedMessage text={message} /></p> : null}
        </div>
        <a className="btn-primary" href="/dashboard/marketplace">
          <Store size={16} strokeWidth={1.8} />
          <Localized en="Open Marketplace" zh="打开应用市场" />
        </a>
      </article>
    );
  }

  return (
    <div className="workflow-marketplace-stack">
      <div className="workflow-marketplace-summary">
        <div>
          <p className="workspace-status-card__eyebrow"><Localized en="Installed tools" zh="已安装的工具" /></p>
          <h2>{loading ? (zh ? "正在加载工作流工具" : "Loading workflow tools") : (zh ? `已安装 ${workflows.length} 个` : `${workflows.length} installed`)}</h2>
          <p><Localized en="Paid workflow tools have dedicated AI credit allocations. Free apps need no credits." zh="付费工作流工具使用专用的 AI 积分配额。免费应用无需积分。" /></p>
        </div>
        <button className="btn-ghost" disabled={loading} onClick={refreshInstalls} type="button">
          <RefreshCw size={16} strokeWidth={1.8} />
          <Localized en="Refresh" zh="刷新" />
        </button>
      </div>

      {error ? <p className="form-error" role="alert"><LocalizedMessage text={error} /></p> : null}
      {message ? <p className="form-success" role="status"><LocalizedMessage text={message} /></p> : null}

      <div className="workflow-grid">
        {workflows.map(({ install, item }) => {
          const isDisabled = install.status === "disabled";
          const isLaunching = launchingId === item.id;
          const isUnsubscribing = unsubscribingId === item.id;
          const installedDate = formatDate(install.installedAt, zh);
          const nextChargeDate = formatDate(install.nextChargeAt, zh);
          const isFree = item.priceTokens === 0;
          const paidToolLocked = !isFree && (!setupComplete || !canUsePaidTools);
          const billingCopy = isFree ? (zh ? "免费，无定期费用。" : "Free, no recurring charges.") : install.allocation?.quotaExempt
            ? (zh ? "管理员无需支付定期 AI 积分费用。" : "Admin exempt from recurring AI credit charges.")
            : isDisabled
              ? (zh ? "积分充足前无法续费。" : "Renewal disabled until enough AI credits are available.")
              : nextChargeDate
                ? (zh ? `下次扣费：${nextChargeDate}` : `Next charge: ${nextChargeDate}`)
                : (zh ? "每月自动续费已启用。" : "Monthly renewal active.");

          return (
            <article className="workflow-card" key={item.id}>
              <div className="workflow-card__header">
                <div>
                  <span className="workspace-status-card__eyebrow"><LocalizedMessage text={item.category} /></span>
                  <h2><LocalizedMessage text={item.title} /></h2>
                </div>
                <span className={`project-status ${isDisabled ? "project-status--failed" : "project-status--ready"}`}>
                  {isDisabled ? (zh ? "已停用" : "disabled") : (zh ? "已安装" : "installed")}
                </span>
              </div>
              <p><LocalizedMessage text={item.description} /></p>
              {!isFree && install.allocation ? (
                <dl className="workflow-card__allocation">
                  <div>
                    <dt><Localized en="Allocated" zh="已分配" /></dt>
                    <dd>{install.allocation.quotaExempt ? (zh ? "免配额" : "Quota exempt") : formatTokens(install.allocation.allocatedTokens, zh)}</dd>
                  </div>
                  <div>
                    <dt><Localized en="Used" zh="已使用" /></dt>
                    <dd>{formatTokens(install.allocation.usedTokens, zh)}</dd>
                  </div>
                  <div>
                    <dt><Localized en="Available" zh="可用" /></dt>
                    <dd>{formatTokens(install.allocation.availableTokens, zh)}</dd>
                  </div>
                </dl>
              ) : null}
              <p className="workflow-card__billing">
                {installedDate ? (zh ? `安装日期：${installedDate}。` : `Installed: ${installedDate}. `) : null}
                {billingCopy}
              </p>
              {isDisabled ? (
                <p className="workflow-card__hint">
                  <Localized en="Add AI credits, then refresh My Workflows to reactivate this workflow tool." zh="添加 AI 积分，然后刷新“我的工作流”以重新启用此工具。" />
                </p>
              ) : null}
              {paidToolLocked && !isDisabled ? (
                <p className="workflow-card__hint">{!setupComplete
                  ? <Localized en="Complete workspace setup before launching this tool." zh="启动此工具前请完成工作空间设置。" />
                  : <Localized en="Add AI credits before launching this tool." zh="启动此工具前请添加 AI 积分。" />}</p>
              ) : null}
              <ol className="workflow-card__steps">
                {item.steps.map((step) => (
                  <li key={step}><LocalizedMessage text={step} /></li>
                ))}
              </ol>
              <div className="workflow-card__actions">
                {item.internalPath ? (
                  <a className="btn-primary" href={item.internalPath}>
                    <Rocket size={16} strokeWidth={1.8} />
                    <LocalizedMessage text={item.launchLabel ?? "Open timer"} />
                  </a>
                ) : item.launchLabel ? (
                  <button
                    className="btn-primary"
                    disabled={isDisabled || isLaunching || paidToolLocked}
                    onClick={() => launchWorkflow(item.id)}
                    type="button"
                  >
                    {isLaunching ? <RefreshCw size={16} strokeWidth={1.8} /> : <Rocket size={16} strokeWidth={1.8} />}
                    {isLaunching ? (zh ? "正在启动..." : "Launching...") : <LocalizedMessage text={item.launchLabel} />}
                  </button>
                ) : null}
                <a className={item.launchLabel ? "btn-ghost" : "btn-primary"} href="/dashboard/marketplace">
                  <Store size={16} strokeWidth={1.8} />
                  <Localized en="Marketplace" zh="应用市场" />
                </a>
                {item.repoUrl ? (
                  <a className="btn-ghost" href={item.repoUrl} rel="noreferrer" target="_blank">
                    <ExternalLink size={16} strokeWidth={1.8} />
                    {item.sourceLabel ?? (zh ? "来源" : "Source")}
                  </a>
                ) : null}
                <button
                  className="btn-ghost danger-button"
                  disabled={isUnsubscribing}
                  onClick={() => unsubscribeWorkflow(item.id, item.title)}
                  type="button"
                >
                  {isDisabled ? <AlertTriangle size={16} strokeWidth={1.8} /> : <Trash2 size={16} strokeWidth={1.8} />}
                  {isUnsubscribing ? (isFree ? (zh ? "正在移除..." : "Removing...") : (zh ? "正在取消订阅..." : "Unsubscribing...")) : isFree ? (zh ? "移除" : "Remove") : (zh ? "取消订阅" : "Unsubscribe")}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
