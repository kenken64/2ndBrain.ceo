"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, Store } from "lucide-react";
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
  installedAt?: string | null;
  itemId: string;
  itemType: string;
  priceTokens: number;
  status: string;
};

type MarketplaceState = {
  installs: MarketplaceInstall[];
  isAdmin: boolean;
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

export function MyWorkflows() {
  const [installs, setInstalls] = useState<MarketplaceInstall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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

    try {
      const response = await fetch("/api/marketplace/installs", {
        cache: "no-store"
      });
      const payload = await readJson<MarketplaceState>(response);

      setInstalls(payload.installs);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Installed workflow tools could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshInstalls();
  }, []);

  if (!loading && workflows.length === 0) {
    return (
      <article className="workflow-empty">
        <div>
          <p className="workspace-status-card__eyebrow">My Workflows</p>
          <h2>No workflow tools installed</h2>
          <p>Install workflow tools from Marketplace, then manage their allocations here.</p>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
        <a className="btn-primary" href="/dashboard/marketplace">
          <Store size={16} strokeWidth={1.8} />
          Open Marketplace
        </a>
      </article>
    );
  }

  return (
    <div className="workflow-marketplace-stack">
      <div className="workflow-marketplace-summary">
        <div>
          <p className="workspace-status-card__eyebrow">Installed tools</p>
          <h2>{loading ? "Loading workflow tools" : `${workflows.length} installed`}</h2>
          <p>Each workflow tool has a dedicated AI credit allocation for its own runs.</p>
        </div>
        <button className="btn-ghost" disabled={loading} onClick={refreshInstalls} type="button">
          <RefreshCw size={16} strokeWidth={1.8} />
          Refresh
        </button>
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <div className="workflow-grid">
        {workflows.map(({ install, item }) => (
          <article className="workflow-card" key={item.id}>
            <div className="workflow-card__header">
              <div>
                <span className="workspace-status-card__eyebrow">{item.category}</span>
                <h2>{item.title}</h2>
              </div>
              <span className="project-status project-status--ready">installed</span>
            </div>
            <p>{item.description}</p>
            {install.allocation ? (
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
              {item.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <div className="workflow-card__actions">
              <a className="btn-primary" href="/dashboard/marketplace">
                <Store size={16} strokeWidth={1.8} />
                Marketplace
              </a>
              {item.repoUrl ? (
                <a className="btn-ghost" href={item.repoUrl} rel="noreferrer" target="_blank">
                  <ExternalLink size={16} strokeWidth={1.8} />
                  {item.sourceLabel ?? "Source"}
                </a>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
