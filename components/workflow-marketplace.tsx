"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Coins, ExternalLink, Plus, RefreshCw, Search } from "lucide-react";
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

function formatTokens(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "Unlimited";
  }

  return new Intl.NumberFormat("en").format(Math.max(0, Math.trunc(value)));
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en", {
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

export function WorkflowMarketplace() {
  const [marketplace, setMarketplace] = useState<MarketplaceState>(emptyState);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(PAGE_SIZE_OPTIONS[0]);
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
      [template.category, template.title].some((value) => value.toLowerCase().includes(needle))
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
          <p className="workspace-status-card__eyebrow">AI credits</p>
          <h2>{marketplace.isAdmin ? "Admin free installs" : `${formatTokens(marketplace.balance.availableTokens)} available`}</h2>
          <p>
            {marketplace.isAdmin
              ? "Admin accounts can install workflow tools without spending AI credits."
              : "Workflow tool purchases move AI credits into a tool-specific allocation."}
          </p>
        </div>
        <button className="btn-ghost" disabled={loading} onClick={refreshMarketplace} type="button">
          <RefreshCw size={16} strokeWidth={1.9} />
          Refresh
        </button>
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="form-success" role="status">{message}</p> : null}

      <div className="workflow-marketplace-pagination" aria-label="Marketplace pagination">
        <label className="workflow-marketplace-search">
          <Search size={16} strokeWidth={1.9} />
          <input
            aria-label="Search marketplace tools by category or tool name"
            onChange={(event) => {
              setSearchTerm(event.target.value);
              setPage(1);
            }}
            placeholder="Search category or tool"
            type="search"
            value={searchTerm}
          />
        </label>
        <span>
          Showing {showingStart}-{pageEnd} of {totalTemplates}
        </span>
        <label>
          Per page
          <select
            aria-label="Marketplace tools per page"
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
          aria-label="Previous marketplace page"
          className="btn-ghost"
          disabled={currentPage <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          type="button"
        >
          <ChevronLeft size={16} strokeWidth={1.9} />
        </button>
        <span>
          Page {currentPage} of {pageCount}
        </span>
        <button
          aria-label="Next marketplace page"
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
            <p className="workspace-status-card__eyebrow">Marketplace</p>
            <h2>No matching workflow tools</h2>
            <p>Search by category or workflow tool name.</p>
          </div>
        </article>
      ) : null}

      <div className="workflow-grid">
        {pageTemplates.map((template) => {
          const install = installByItemId.get(template.id);
          const isDisabled = install?.status === "disabled";
          const isInstalled = Boolean(install);
          const isInstalling = installingId === template.id;
          const hasEnoughCredits = loading || marketplace.balance.availableTokens >= template.priceTokens;
          const missingTokens = Math.max(0, template.priceTokens - marketplace.balance.availableTokens);
          const canInstall = !loading && !isInstalled && !isInstalling && (marketplace.isAdmin || hasEnoughCredits);
          const statusClass = isDisabled
            ? " project-status--failed"
            : isInstalled
            ? " project-status--ready"
            : !loading && !marketplace.isAdmin && !hasEnoughCredits
              ? " project-status--failed"
              : " project-status--running";
          const priceCopy = marketplace.isAdmin
            ? `Listed price: ${formatTokens(template.priceTokens)} AI credits. Admin install: free`
            : `Requires ${formatTokens(template.priceTokens)} AI credits`;
          const installedDate = formatDate(install?.installedAt);
          const nextChargeDate = formatDate(install?.nextChargeAt);
          const billingCopy = install?.allocation?.quotaExempt
            ? "Admin exempt from recurring AI credit charges."
            : nextChargeDate
              ? `Next charge: ${nextChargeDate}`
              : "Monthly renewal active.";

          return (
            <article className="workflow-card" key={template.id}>
              <div className="workflow-card__header">
                <div>
                  <span className="workspace-status-card__eyebrow">{template.category}</span>
                  <h2>{template.title}</h2>
                </div>
                <span className={`project-status${statusClass}`}>
                  {isDisabled
                    ? "disabled"
                    : isInstalled
                      ? "installed"
                      : !loading && !marketplace.isAdmin && !hasEnoughCredits
                        ? "locked"
                        : "available"}
                </span>
              </div>
              <p>{template.description}</p>
              <div className="workflow-card__price">
                <Coins size={16} strokeWidth={1.9} />
                <span>{priceCopy}</span>
              </div>
              {!marketplace.isAdmin && !install ? (
                <p className="workflow-card__billing">
                  Need {formatTokens(template.priceTokens)} AI credits to install.{" "}
                  {hasEnoughCredits
                    ? `${formatTokens(marketplace.balance.availableTokens)} available now.`
                    : `${formatTokens(missingTokens)} more needed.`}
                </p>
              ) : null}
              {install?.allocation ? (
                <dl className="workflow-card__allocation">
                  <div>
                    <dt>Allocated</dt>
                    <dd>{install.allocation.quotaExempt ? "Quota exempt" : formatTokens(install.allocation.allocatedTokens)}</dd>
                  </div>
                  <div>
                    <dt>Used</dt>
                    <dd>{formatTokens(install.allocation.usedTokens)}</dd>
                  </div>
                  <div>
                    <dt>Available</dt>
                    <dd>{formatTokens(install.allocation.availableTokens)}</dd>
                  </div>
                </dl>
              ) : null}
              {install ? (
                <p className="workflow-card__billing">
                  {installedDate ? `Installed: ${installedDate}. ` : null}
                  {billingCopy}
                </p>
              ) : null}
              <ol className="workflow-card__steps">
                {template.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <div className="workflow-card__actions">
                <button
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
                  {isDisabled ? "Disabled" : isInstalled ? "Installed" : isInstalling ? "Installing..." : "Install"}
                </button>
                {template.repoUrl ? (
                  <a className="btn-ghost" href={template.repoUrl} rel="noreferrer" target="_blank">
                    <ExternalLink size={16} strokeWidth={1.9} />
                    {template.sourceLabel ?? "Source"}
                  </a>
                ) : null}
              </div>
              {!loading && !marketplace.isAdmin && !isInstalled && !hasEnoughCredits ? (
                <p className="workflow-card__hint">
                  Add {formatTokens(missingTokens)} more AI credits to install this workflow tool.
                </p>
              ) : null}
              {isDisabled ? (
                <p className="workflow-card__hint">
                  Add AI credits, then refresh Marketplace to reactivate this workflow tool.
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
