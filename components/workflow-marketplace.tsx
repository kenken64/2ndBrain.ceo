"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Coins, ExternalLink, Plus, RefreshCw } from "lucide-react";
import { WORKFLOW_TEMPLATES } from "@/lib/workflow-templates";

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
  installedAt?: string | null;
  itemId: string;
  itemType: string;
  priceTokens: number;
  status: string;
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
  const installByItemId = useMemo(
    () => new Map(marketplace.installs.map((install) => [install.itemId, install])),
    [marketplace.installs]
  );

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

      <div className="workflow-grid">
        {WORKFLOW_TEMPLATES.map((template) => {
          const install = installByItemId.get(template.id);
          const isInstalled = Boolean(install);
          const isInstalling = installingId === template.id;
          const hasEnoughCredits = loading || marketplace.balance.availableTokens >= template.priceTokens;
          const canInstall = !loading && !isInstalled && !isInstalling && (marketplace.isAdmin || hasEnoughCredits);
          const statusClass = isInstalled
            ? " project-status--ready"
            : !loading && !marketplace.isAdmin && !hasEnoughCredits
              ? " project-status--failed"
              : " project-status--running";
          const priceCopy = marketplace.isAdmin ? "Admin: free install" : `${formatTokens(template.priceTokens)} AI credits`;

          return (
            <article className="workflow-card" key={template.id}>
              <div className="workflow-card__header">
                <div>
                  <span className="workspace-status-card__eyebrow">{template.category}</span>
                  <h2>{template.title}</h2>
                </div>
                <span className={`project-status${statusClass}`}>
                  {isInstalled ? "installed" : !loading && !marketplace.isAdmin && !hasEnoughCredits ? "locked" : "available"}
                </span>
              </div>
              <p>{template.description}</p>
              <div className="workflow-card__price">
                <Coins size={16} strokeWidth={1.9} />
                <span>{priceCopy}</span>
              </div>
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
                  {isInstalled ? (
                    <Check size={16} strokeWidth={1.9} />
                  ) : isInstalling ? (
                    <RefreshCw size={16} strokeWidth={1.9} />
                  ) : (
                    <Plus size={16} strokeWidth={1.9} />
                  )}
                  {isInstalled ? "Installed" : isInstalling ? "Installing..." : "Install"}
                </button>
                {template.repoUrl ? (
                  <a className="btn-ghost" href={template.repoUrl} rel="noreferrer" target="_blank">
                    <ExternalLink size={16} strokeWidth={1.9} />
                    {template.sourceLabel ?? "Source"}
                  </a>
                ) : null}
              </div>
              {!loading && !marketplace.isAdmin && !isInstalled && !hasEnoughCredits ? (
                <p className="workflow-card__hint">Add AI credits to install this workflow tool.</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
