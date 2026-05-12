"use client";

import { useEffect, useState } from "react";

type GatewayPayload = {
  error?: string;
  gatewayUrl?: string | null;
  status?: string;
};

type OpenClawGatewayStatusProps = {
  initialGatewayUrl?: string | null;
  instance?: string | null;
};

const POLL_INTERVAL_MS = 10_000;

export function OpenClawGatewayStatus({
  initialGatewayUrl,
  instance
}: OpenClawGatewayStatusProps) {
  const [gatewayUrl, setGatewayUrl] = useState(initialGatewayUrl?.trim() || "");
  const [lastError, setLastError] = useState("");
  const hasInstance = Boolean(instance?.trim());
  const isReady = Boolean(gatewayUrl);

  useEffect(() => {
    if (!hasInstance || gatewayUrl) {
      return;
    }

    let isCancelled = false;
    let isFetching = false;

    async function fetchGatewayUrl() {
      if (isFetching) {
        return;
      }

      isFetching = true;

      try {
        const response = await fetch("/api/openclaw/gateway-url", {
          cache: "no-store",
          credentials: "same-origin"
        });
        const payload = (await response.json().catch(() => null)) as GatewayPayload | null;

        if (isCancelled) {
          return;
        }

        if (response.ok && payload?.gatewayUrl) {
          setGatewayUrl(payload.gatewayUrl);
          setLastError("");
          return;
        }

        if (payload?.error) {
          setLastError(payload.error);
        }
      } catch (error) {
        if (!isCancelled) {
          setLastError(error instanceof Error ? error.message : "Gateway URL check failed");
        }
      } finally {
        isFetching = false;
      }
    }

    void fetchGatewayUrl();
    const interval = window.setInterval(fetchGatewayUrl, POLL_INTERVAL_MS);

    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, [gatewayUrl, hasInstance]);

  return (
    <article className="workspace-status-card" id="gateway-ui">
      <div className="workspace-status-card__header">
        <div>
          <p className="workspace-status-card__eyebrow">OpenClaw Gateway UI</p>
          <h2>Gateway entry point</h2>
        </div>
        <span className={`project-status project-status--${isReady ? "ready" : hasInstance ? "running" : "draft"}`}>
          {isReady ? "ready" : hasInstance ? "checking" : "pending"}
        </span>
      </div>
      <p className="workspace-status-card__copy">
        Launch the OpenClaw workspace through its Tailscale Funnel public HTTPS URL.
      </p>
      <dl className="workspace-status-list">
        <div>
          <dt>Stored instance</dt>
          <dd>{instance ?? "Not available yet"}</dd>
        </div>
        <div>
          <dt>Tailscale Funnel URL</dt>
          <dd>{gatewayUrl || "Waiting for Tailscale Funnel to publish the URL"}</dd>
        </div>
        <div>
          <dt>Launch mode</dt>
          <dd>{gatewayUrl ? "Tailscale Funnel public HTTPS URL" : "Polling every 10 seconds until available"}</dd>
        </div>
      </dl>
      {lastError && !gatewayUrl ? <p className="workspace-status-card__hint">Last check: {lastError}</p> : null}
      <div className="workspace-status-actions">
        <a className="btn-primary" href="/dashboard/openclaw">
          Open OpenClaw section <span className="arrow">-&gt;</span>
        </a>
        {gatewayUrl ? (
          <a className="text-link" href={gatewayUrl} rel="noreferrer" target="_blank">
            Open Tailscale Gateway -&gt;
          </a>
        ) : (
          <span className="text-link is-disabled">Waiting for gateway URL</span>
        )}
      </div>
    </article>
  );
}
