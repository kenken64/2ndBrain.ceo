"use client";

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
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
    const confirmed = window.confirm(`Unsubscribe ${title}? Future recurring AI credit charges will stop.`);

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
          <p className="workspace-status-card__eyebrow">My Workflows</p>
          <h2>No workflow tools installed</h2>
          <p>Install workflow tools from Marketplace, then manage their allocations here.</p>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {message ? <p className="form-success" role="status">{message}</p> : null}
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
      {message ? <p className="form-success" role="status">{message}</p> : null}

      <div className="workflow-grid">
        {workflows.map(({ install, item }) => {
          const isDisabled = install.status === "disabled";
          const isLaunching = launchingId === item.id;
          const isUnsubscribing = unsubscribingId === item.id;
          const installedDate = formatDate(install.installedAt);
          const nextChargeDate = formatDate(install.nextChargeAt);
          const billingCopy = install.allocation?.quotaExempt
            ? "Admin exempt from recurring AI credit charges."
            : isDisabled
              ? "Renewal disabled until enough AI credits are available."
              : nextChargeDate
                ? `Next charge: ${nextChargeDate}`
                : "Monthly renewal active.";

          return (
            <article className="workflow-card" key={item.id}>
              <div className="workflow-card__header">
                <div>
                  <span className="workspace-status-card__eyebrow">{item.category}</span>
                  <h2>{item.title}</h2>
                </div>
                <span className={`project-status ${isDisabled ? "project-status--failed" : "project-status--ready"}`}>
                  {isDisabled ? "disabled" : "installed"}
                </span>
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
              <p className="workflow-card__billing">
                {installedDate ? `Installed: ${installedDate}. ` : null}
                {billingCopy}
              </p>
              {isDisabled ? (
                <p className="workflow-card__hint">
                  Add AI credits, then refresh My Workflows to reactivate this workflow tool.
                </p>
              ) : null}
              <ol className="workflow-card__steps">
                {item.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <div className="workflow-card__actions">
                {item.launchLabel ? (
                  <button
                    className="btn-primary"
                    disabled={isDisabled || isLaunching}
                    onClick={() => launchWorkflow(item.id)}
                    type="button"
                  >
                    {isLaunching ? <RefreshCw size={16} strokeWidth={1.8} /> : <Rocket size={16} strokeWidth={1.8} />}
                    {isLaunching ? "Launching..." : item.launchLabel}
                  </button>
                ) : null}
                <a className={item.launchLabel ? "btn-ghost" : "btn-primary"} href="/dashboard/marketplace">
                  <Store size={16} strokeWidth={1.8} />
                  Marketplace
                </a>
                {item.repoUrl ? (
                  <a className="btn-ghost" href={item.repoUrl} rel="noreferrer" target="_blank">
                    <ExternalLink size={16} strokeWidth={1.8} />
                    {item.sourceLabel ?? "Source"}
                  </a>
                ) : null}
                <button
                  className="btn-ghost danger-button"
                  disabled={isUnsubscribing}
                  onClick={() => unsubscribeWorkflow(item.id, item.title)}
                  type="button"
                >
                  {isDisabled ? <AlertTriangle size={16} strokeWidth={1.8} /> : <Trash2 size={16} strokeWidth={1.8} />}
                  {isUnsubscribing ? "Unsubscribing..." : "Unsubscribe"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
