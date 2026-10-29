"use client";

import { Localized, useLanguage, LocalizedMessage } from "@/components/language-provider";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Coins, ExternalLink, Plus, RefreshCw, Search, Timer } from "lucide-react";
import { uiMessagesZh } from "@/lib/ui-messages";
import { WORKFLOW_TEMPLATES } from "@/lib/workflow-templates";

const PAGE_SIZE_OPTIONS = [6, 12] as const;

type MarketplaceBalance = {
  availableTokens: number;
  llmTokenQuota: number;
  llmTokenUsed: number;
};

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
  balance: MarketplaceBalance;
  installs: MarketplaceInstall[];
  isAdmin: boolean;
};

type InstallResponse = {
  balance: MarketplaceBalance;
  install: MarketplaceInstall & {
    alreadyInstalled?: boolean;
  };
  isAdmin: boolean;
};

const emptyState: MarketplaceState = {
  balance: {
    availableTokens: 0,
    llmTokenQuota: 0,
    llmTokenUsed: 0
  },
  installs: [],
  isAdmin: false
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
    throw new Error(payload?.error ?? "Marketplace request failed.");
  }

  if (!payload) {
    throw new Error("Marketplace response was empty.");
  }

  return payload;
}

export function WorkflowMarketplace({ setupComplete = true }: { setupComplete?: boolean }) {
  const { language } = useLanguage();
  const zh = language === "zh";
  const [marketplace, setMarketplace] = useState<MarketplaceState>(emptyState);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(PAGE_SIZE_OPTIONS[1]);
  const [searchTerm, setSearchTerm] = useState("");
  const installByItemId = useMemo(
    () => new Map(marketplace.installs.map((install) => [install.itemId, install])),
    [marketplace.installs]
  );
  const filteredTemplates = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();

    if (!needle) {
      return WORKFLOW_TEMPLATES;
    }

    return WORKFLOW_TEMPLATES.filter((template) =>
      [template.category, template.title, uiMessagesZh[template.category] ?? "", uiMessagesZh[template.title] ?? ""].some((value) => value.toLowerCase().includes(needle))
    );
  }, [searchTerm]);
  const totalTemplates = filteredTemplates.length;
  const pageCount = Math.max(1, Math.ceil(totalTemplates / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, totalTemplates);
  const pageTemplates = filteredTemplates.slice(pageStart, pageEnd);
  const showingStart = totalTemplates > 0 ? pageStart + 1 : 0;

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  async function refreshMarketplace() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/marketplace/installs", {
        cache: "no-store"
      });
      const payload = await readJson<MarketplaceState>(response);

      setMarketplace(payload);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Marketplace could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshMarketplace();
  }, []);

  async function installWorkflow(id: string) {
    setInstallingId(id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/marketplace/install", {
        body: JSON.stringify({ itemId: id }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const payload = await readJson<InstallResponse>(response);

      setMarketplace((current) => {
        const installMap = new Map(current.installs.map((install) => [install.itemId, install]));

        installMap.set(payload.install.itemId, payload.install);

        return {
          balance: payload.balance,
          installs: Array.from(installMap.values()),
          isAdmin: payload.isAdmin
        };
      });
      setMessage(
        payload.install.alreadyInstalled
          ? "Workflow tool is already installed."
          : WORKFLOW_TEMPLATES.find((item) => item.id === id)?.priceTokens === 0
            ? "Free app installed. Open it from My Workflows."
          : payload.install.allocation?.quotaExempt
            ? "Workflow tool installed with admin quota exemption."
            : `Workflow tool installed and ${formatTokens(payload.install.chargedTokens)} AI credits allocated.`
      );
      await refreshMarketplace();
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : "Workflow tool could not be installed.");
    } finally {
      setInstallingId(null);
    }
  }

  return (
    <div className="workflow-marketplace-stack">
      <div className="workflow-marketplace-summary">
        <div>
          <p className="workspace-status-card__eyebrow"><Localized en="AI credits" zh="AI 积分" /></p>
          <h2>{marketplace.isAdmin ? (zh ? "管理员免费安装" : "Admin free installs") : (zh ? `可用 ${formatTokens(marketplace.balance.availableTokens)}` : `${formatTokens(marketplace.balance.availableTokens)} available`)}</h2>
          <p>
            {marketplace.isAdmin
              ? (zh ? "管理员账户安装工作流工具无需消耗 AI 积分。" : "Admin accounts can install workflow tools without spending AI credits.")
              : (zh ? "购买工作流工具时，AI 积分会转入该工具的专用配额。" : "Workflow tool purchases move AI credits into a tool-specific allocation.")}
          </p>
        </div>
        <button className="btn-ghost" disabled={loading} onClick={refreshMarketplace} type="button">
          <RefreshCw size={16} strokeWidth={1.9} />
          <Localized en="Refresh" zh="刷新" />
        </button>
      </div>

      {error ? <p className="form-error" role="alert"><LocalizedMessage text={error} /></p> : null}
      {message ? <p className="form-success" role="status"><LocalizedMessage text={message} /></p> : null}

      <div className="workflow-marketplace-pagination" aria-label={zh ? "应用市场分页" : "Marketplace pagination"}>
        <label className="workflow-marketplace-search">
          <Search size={16} strokeWidth={1.9} />
          <input
            aria-label={zh ? "按类别或名称搜索应用市场工具" : "Search marketplace tools by category or tool name"}
            onChange={(event) => {
              setSearchTerm(event.target.value);
              setPage(1);
            }}
            placeholder={zh ? "搜索类别或工具" : "Search category or tool"}
            type="search"
            value={searchTerm}
          />
        </label>
        <span>
          {zh ? `显示 ${showingStart}-${pageEnd}，共 ${totalTemplates} 个` : `Showing ${showingStart}-${pageEnd} of ${totalTemplates}`}
        </span>
        <label>
          <Localized en="Per page" zh="每页" />
          <select
            aria-label={zh ? "每页显示的应用市场工具数" : "Marketplace tools per page"}
            onChange={(event) => {
              setPageSize(Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number]);
              setPage(1);
            }}
            value={pageSize}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <button
          aria-label={zh ? "应用市场上一页" : "Previous marketplace page"}
          className="btn-ghost"
          disabled={currentPage <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          type="button"
        >
          <ChevronLeft size={16} strokeWidth={1.9} />
        </button>
        <span>
          {zh ? `第 ${currentPage} 页，共 ${pageCount} 页` : `Page ${currentPage} of ${pageCount}`}
        </span>
        <button
          aria-label={zh ? "应用市场下一页" : "Next marketplace page"}
          className="btn-ghost"
          disabled={currentPage >= pageCount}
          onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
          type="button"
        >
          <ChevronRight size={16} strokeWidth={1.9} />
        </button>
      </div>

      {totalTemplates === 0 ? (
        <article className="workflow-empty">
          <div>
            <p className="workspace-status-card__eyebrow"><Localized en="Marketplace" zh="应用市场" /></p>
            <h2><Localized en="No matching workflow tools" zh="没有匹配的工作流工具" /></h2>
            <p><Localized en="Search by category or workflow tool name." zh="按类别或工作流工具名称搜索。" /></p>
          </div>
        </article>
      ) : null}

      <div className="workflow-grid">
        {pageTemplates.map((template) => {
          const install = installByItemId.get(template.id);
          const isBuiltIn = Boolean(template.internalPath);
          const isDisabled = install?.status === "disabled";
          const isInstalled = Boolean(install);
          const isInstalling = installingId === template.id;
          const hasEnoughCredits = loading || marketplace.balance.availableTokens >= template.priceTokens;
          const missingTokens = Math.max(0, template.priceTokens - marketplace.balance.availableTokens);
          const canInstall = (setupComplete || isBuiltIn) && !loading && !isInstalled && !isInstalling && (marketplace.isAdmin || hasEnoughCredits);
          const statusClass = isDisabled
            ? " project-status--failed"
            : isInstalled
            ? " project-status--ready"
            : !loading && !marketplace.isAdmin && !hasEnoughCredits
              ? " project-status--failed"
              : " project-status--running";
          const priceCopy = isBuiltIn ? (zh ? "免费 · 内置应用" : "Free · Built-in app") : marketplace.isAdmin
            ? (zh ? `标价：${formatTokens(template.priceTokens)} AI 积分。管理员免费安装` : `Listed price: ${formatTokens(template.priceTokens)} AI credits. Admin install: free`)
            : (zh ? `需要 ${formatTokens(template.priceTokens)} AI 积分` : `Requires ${formatTokens(template.priceTokens)} AI credits`);
          const installedDate = formatDate(install?.installedAt, zh);
          const nextChargeDate = formatDate(install?.nextChargeAt, zh);
          const billingCopy = install?.allocation?.quotaExempt
            ? (zh ? "管理员无需支付定期 AI 积分费用。" : "Admin exempt from recurring AI credit charges.")
            : nextChargeDate
              ? (zh ? `下次扣费：${nextChargeDate}` : `Next charge: ${nextChargeDate}`)
              : (zh ? "每月自动续费已启用。" : "Monthly renewal active.");

          return (
            <article className="workflow-card" key={template.id}>
              <div className="workflow-card__header">
                <div>
                  <span className="workspace-status-card__eyebrow"><LocalizedMessage text={template.category} /></span>
                  <h2><LocalizedMessage text={template.title} /></h2>
                </div>
                <span className={`project-status${statusClass}`}>
                  {isDisabled
                    ? (zh ? "已停用" : "disabled")
                    : isInstalled
                      ? (zh ? "已安装" : "installed")
                      : isBuiltIn
                        ? (zh ? "可用" : "available")
                      : !loading && !marketplace.isAdmin && !hasEnoughCredits
                        ? (zh ? "未解锁" : "locked")
                        : (zh ? "可用" : "available")}
                </span>
              </div>
              <p><LocalizedMessage text={template.description} /></p>
              <div className="workflow-card__price">
                <Coins size={16} strokeWidth={1.9} />
                <span>{priceCopy}</span>
              </div>
              {!isBuiltIn && !marketplace.isAdmin && !install ? (
                <p className="workflow-card__billing">
                  {zh ? `安装需要 ${formatTokens(template.priceTokens)} AI 积分。` : `Need ${formatTokens(template.priceTokens)} AI credits to install. `}
                  {hasEnoughCredits
                    ? (zh ? `目前可用 ${formatTokens(marketplace.balance.availableTokens)}。` : `${formatTokens(marketplace.balance.availableTokens)} available now.`)
                    : (zh ? `还需 ${formatTokens(missingTokens)}。` : `${formatTokens(missingTokens)} more needed.`)}
                </p>
              ) : null}
              {!isBuiltIn && install?.allocation ? (
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
              {!isBuiltIn && install ? (
                <p className="workflow-card__billing">
                  {installedDate ? (zh ? `安装日期：${installedDate}。` : `Installed: ${installedDate}. `) : null}
                  {billingCopy}
                </p>
              ) : null}
              <ol className="workflow-card__steps">
                {template.steps.map((step) => (
                  <li key={step}><LocalizedMessage text={step} /></li>
                ))}
              </ol>
              <div className="workflow-card__actions">
                {template.internalPath && isInstalled && !isDisabled ? (
                  <a className="btn-primary" href={template.internalPath}>
                    <Timer size={16} strokeWidth={1.9} />
                    <Localized en="Open timer" zh="打开计时器" />
                  </a>
                ) : <button
                  className={isInstalled ? "btn-ghost" : "btn-primary"}
                  disabled={!canInstall}
                  onClick={() => installWorkflow(template.id)}
                  type="button"
                >
                  {isDisabled ? (
                    <AlertTriangle size={16} strokeWidth={1.9} />
                  ) : isInstalled ? (
                    <Check size={16} strokeWidth={1.9} />
                  ) : isInstalling ? (
                    <RefreshCw size={16} strokeWidth={1.9} />
                  ) : (
                    <Plus size={16} strokeWidth={1.9} />
                  )}
                  {isDisabled ? (zh ? "已停用" : "Disabled") : isInstalled ? (zh ? "已安装" : "Installed") : isInstalling ? (zh ? "正在安装..." : "Installing...") : (zh ? "安装" : "Install")}
                </button>}
                {template.repoUrl ? (
                  <a className="btn-ghost" href={template.repoUrl} rel="noreferrer" target="_blank">
                    <ExternalLink size={16} strokeWidth={1.9} />
                    {template.sourceLabel ?? (zh ? "来源" : "Source")}
                  </a>
                ) : null}
              </div>
              {!isBuiltIn && !loading && !marketplace.isAdmin && !isInstalled && !hasEnoughCredits ? (
                <p className="workflow-card__hint">
                  {zh ? `再添加 ${formatTokens(missingTokens)} AI 积分即可安装此工具。` : `Add ${formatTokens(missingTokens)} more AI credits to install this workflow tool.`}
                </p>
              ) : null}
              {!isBuiltIn && !setupComplete && !isInstalled ? (
                <p className="workflow-card__hint"><Localized en="Complete workspace setup before installing this tool." zh="安装此工具前请完成工作空间设置。" /> <a href="/onboarding?next=%2Fdashboard%2Fmarketplace"><Localized en="Continue setup" zh="继续设置" /></a></p>
              ) : null}
              {isDisabled ? (
                <p className="workflow-card__hint">
                  <Localized en="Add AI credits, then refresh Marketplace to reactivate this workflow tool." zh="添加 AI 积分，然后刷新应用市场以重新启用此工具。" />
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
