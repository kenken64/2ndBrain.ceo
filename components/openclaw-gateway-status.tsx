"use client";

import { useEffect, useState } from "react";

type GatewayPayload = {
  error?: string;
  gatewayUrl?: string | null;
  status?: string;
};

type PublicIpPayload = {
  error?: string;
  publicIp?: string | null;
  source?: string;
  status?: string;
};

type OpenClawGatewayStatusProps = {
  initialGatewayUrl?: string | null;
  instance?: string | null;
};

const POLL_INTERVAL_MS = 10_000;

function isIpAddress(value: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

export function OpenClawGatewayStatus({
  initialGatewayUrl,
  instance
}: OpenClawGatewayStatusProps) {
  const [gatewayUrl, setGatewayUrl] = useState(initialGatewayUrl?.trim() || "");
  const [lastError, setLastError] = useState("");
  const instanceAddress = instance?.trim() || "";
  const [publicIp, setPublicIp] = useState(isIpAddress(instanceAddress) ? instanceAddress : "");
  const [publicIpError, setPublicIpError] = useState("");
  const [isPublicIpVisible, setIsPublicIpVisible] = useState(false);
  const hasInstance = Boolean(instanceAddress);
  const isReady = Boolean(gatewayUrl);
  const hiddenPublicIpValue = publicIp ? "**** **** ****" : hasInstance ? "Resolving public IP" : "Not available yet";

  useEffect(() => {
    if (!hasInstance) {
      return;
    }

    let isCancelled = false;
    let isFetching = false;

    async function fetchPublicIp() {
      if (isFetching) {
        return;
      }

      isFetching = true;

      try {
        const response = await fetch("/api/openclaw/public-ip", {
          cache: "no-store",
          credentials: "same-origin"
        });
        const payload = (await response.json().catch(() => null)) as PublicIpPayload | null;

        if (isCancelled) {
          return;
        }

        if (response.ok && payload?.publicIp) {
          setPublicIp(payload.publicIp);
          setPublicIpError("");
          return;
        }

        if (payload?.error) {
          setPublicIpError(payload.error);
        }
      } catch (error) {
        if (!isCancelled) {
          setPublicIpError(error instanceof Error ? error.message : "Public IP check failed");
        }
      } finally {
        isFetching = false;
      }
    }

    void fetchPublicIp();
    const interval = window.setInterval(fetchPublicIp, POLL_INTERVAL_MS);

    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, [hasInstance]);

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
          <dt>OpenClaw IP address</dt>
          <dd className="workspace-secret-field">
            <span>{isPublicIpVisible ? publicIp : hiddenPublicIpValue}</span>
            {publicIp ? (
              <button
                aria-label={`${isPublicIpVisible ? "Hide" : "Show"} OpenClaw IP address`}
                className="workspace-secret-toggle"
                onClick={() => setIsPublicIpVisible((current) => !current)}
                type="button"
              >
                {isPublicIpVisible ? "Hide" : "Show"}
              </button>
            ) : null}
          </dd>
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
      {publicIpError && !publicIp ? <p className="workspace-status-card__hint">IP check: {publicIpError}</p> : null}
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
