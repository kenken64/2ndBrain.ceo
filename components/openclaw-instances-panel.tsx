"use client";

import { useEffect, useState } from "react";
import { Cpu, Plus, RefreshCw, Trash2 } from "lucide-react";

type OpenClawInstance = {
  consumerName: string;
  createdAt: string | null;
  error: string | null;
  id: string;
  instance: string | null;
  label: string | null;
  region: string | null;
  status: string;
  updatedAt: string | null;
};

type InstancesResponse = {
  instances: OpenClawInstance[];
  maxInstances: number;
};

const ERROR_COPY: Record<string, string> = {
  insufficient_ai_credits: "Not enough AI credits to provision a new OpenClaw instance.",
  instance_limit_reached: "You have reached the maximum number of OpenClaw instances.",
  missing_fields: "Finish onboarding (avatar and Telegram bot) before provisioning an instance.",
  openclaw_deprovision_failed: "The instance could not be fully removed. Try again.",
  openclaw_provision_failed: "Provisioning failed. Please try again.",
  provision_running: "Another instance is still provisioning. Wait for it to finish."
};

function friendlyError(code: string | undefined, fallback: string) {
  if (code && ERROR_COPY[code]) {
    return ERROR_COPY[code];
  }

  return code || fallback;
}

function formatDate(value: string | null) {
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

function statusClass(status: string) {
  if (status === "ready") {
    return "project-status project-status--ready";
  }

  if (status === "failed") {
    return "project-status project-status--failed";
  }

  return "project-status";
}

export function OpenClawInstancesPanel() {
  const [instances, setInstances] = useState<OpenClawInstance[]>([]);
  const [maxInstances, setMaxInstances] = useState(0);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/openclaw/instances", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | (InstancesResponse & { error?: string })
        | null;

      if (!response.ok || !payload) {
        throw new Error(friendlyError(payload?.error, "OpenClaw instances could not be loaded."));
      }

      setInstances(payload.instances);
      setMaxInstances(payload.maxInstances);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "OpenClaw instances could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function provisionInstance() {
    setProvisioning(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/openclaw/instances", {
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(friendlyError(payload?.error, "The OpenClaw instance could not be provisioned."));
      }

      setMessage("OpenClaw instance provisioned. It now appears in the Gyne Agent.");
      await refresh();
    } catch (provisionError) {
      setError(provisionError instanceof Error ? provisionError.message : "The OpenClaw instance could not be provisioned.");
    } finally {
      setProvisioning(false);
    }
  }

  async function removeInstance(id: string, name: string) {
    const confirmed = window.confirm(`Remove OpenClaw instance ${name}? This tears down the instance and removes it from the Gyne Agent.`);

    if (!confirmed) {
      return;
    }

    setRemovingId(id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/openclaw/instances/${id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(friendlyError(payload?.error, "The OpenClaw instance could not be removed."));
      }

      setInstances((current) => current.filter((instance) => instance.id !== id));
      setMessage("OpenClaw instance removed.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "The OpenClaw instance could not be removed.");
    } finally {
      setRemovingId(null);
    }
  }

  const activeCount = instances.filter((instance) => instance.status !== "failed" && instance.status !== "stopped").length;
  const atLimit = maxInstances > 0 && activeCount >= maxInstances;
  const provisionDisabled = provisioning || atLimit;

  return (
    <section className="workflow-marketplace-stack">
      <div className="workflow-marketplace-summary">
        <div>
          <p className="workspace-status-card__eyebrow">OpenClaw instances</p>
          <h2>
            {loading
              ? "Loading OpenClaw instances"
              : maxInstances > 0
                ? `${activeCount} of ${maxInstances} in use`
                : `${activeCount} in use`}
          </h2>
          <p>Each instance is a private OpenClaw worker that only you can see and use in the Gyne Agent.</p>
        </div>
        <div className="workflow-card__actions">
          <button className="btn-ghost" disabled={loading || provisioning} onClick={refresh} type="button">
            <RefreshCw size={16} strokeWidth={1.8} />
            Refresh
          </button>
          <button className="btn-primary" disabled={provisionDisabled} onClick={provisionInstance} type="button">
            {provisioning ? <RefreshCw size={16} strokeWidth={1.8} /> : <Plus size={16} strokeWidth={1.8} />}
            {provisioning ? "Provisioning..." : "Provision instance"}
          </button>
        </div>
      </div>

      {atLimit ? (
        <p className="workflow-card__hint">
          You have reached your OpenClaw instance limit. Remove an instance to provision another.
        </p>
      ) : null}
      {provisioning ? (
        <p className="workflow-card__hint">Provisioning a new instance can take a few minutes. Keep this tab open.</p>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="form-success" role="status">{message}</p> : null}

      {!loading && instances.length === 0 ? (
        <article className="workflow-empty">
          <div>
            <p className="workspace-status-card__eyebrow">No instances yet</p>
            <h2>Provision your first OpenClaw instance</h2>
            <p>Provisioned instances appear in the Gyne Agent so you can route tasks to them.</p>
          </div>
        </article>
      ) : null}

      {instances.length > 0 ? (
        <div className="workflow-grid">
          {instances.map((instance) => {
            const createdDate = formatDate(instance.createdAt);
            const isRemoving = removingId === instance.id;

            return (
              <article className="workflow-card" key={instance.id}>
                <div className="workflow-card__header">
                  <div>
                    <span className="workspace-status-card__eyebrow">
                      <Cpu size={14} strokeWidth={1.8} /> OpenClaw
                    </span>
                    <h2>{instance.label || instance.consumerName}</h2>
                  </div>
                  <span className={statusClass(instance.status)}>{instance.status}</span>
                </div>
                <dl className="workflow-card__allocation">
                  <div>
                    <dt>Consumer</dt>
                    <dd>{instance.consumerName}</dd>
                  </div>
                  <div>
                    <dt>Instance</dt>
                    <dd>{instance.instance ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Region</dt>
                    <dd>{instance.region ?? "—"}</dd>
                  </div>
                </dl>
                <p className="workflow-card__billing">{createdDate ? `Created: ${createdDate}.` : ""}</p>
                {instance.status === "failed" && instance.error ? (
                  <p className="workflow-card__hint">{instance.error}</p>
                ) : null}
                <div className="workflow-card__actions">
                  <button
                    className="btn-ghost danger-button"
                    disabled={isRemoving}
                    onClick={() => removeInstance(instance.id, instance.label || instance.consumerName)}
                    type="button"
                  >
                    <Trash2 size={16} strokeWidth={1.8} />
                    {isRemoving ? "Removing..." : "Remove"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
