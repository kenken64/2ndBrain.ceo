"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

type RemotionUrlPayload = {
  code?: string;
  error?: string;
  remotionUrl?: string | null;
  source?: string;
  status?: "pending" | "ready" | "stale";
};

type RemotionAvatarStatusProps = {
  avatarName?: string | null;
  initialRemotionUrl?: string | null;
};

const POLL_INTERVAL_MS = 30_000;

export function RemotionAvatarStatus({
  avatarName,
  initialRemotionUrl
}: RemotionAvatarStatusProps) {
  const [remotionUrl, setRemotionUrl] = useState(initialRemotionUrl?.trim() || "");
  const [status, setStatus] = useState<"pending" | "ready" | "stale">(remotionUrl ? "ready" : "pending");
  const [lastError, setLastError] = useState("");
  const [isPaused, setIsPaused] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isReady = Boolean(remotionUrl) && status !== "stale";

  async function fetchRemotionUrl(forceRefresh = false) {
    const response = await fetch(`/api/openclaw/remotion-url${forceRefresh ? "?refresh=1" : ""}`, {
      cache: "no-store",
      credentials: "same-origin"
    });
    const payload = (await response.json().catch(() => null)) as RemotionUrlPayload | null;

    if (response.status === 423 || payload?.code === "openclaw_tokens_paused") {
      setIsPaused(true);
      setLastError("");
      return;
    }

    setIsPaused(false);

    if (payload?.remotionUrl) {
      setRemotionUrl(payload.remotionUrl);
    }

    if (payload?.status) {
      setStatus(payload.status);
    }

    if (response.ok && payload?.remotionUrl && payload.status === "ready") {
      setLastError("");
      return;
    }

    if (payload?.error) {
      setLastError(payload.error);
    }
  }

  async function refreshNow() {
    if (isRefreshing) {
      return;
    }

    setIsRefreshing(true);

    try {
      await fetchRemotionUrl(true);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Remotion URL refresh failed");
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    let isCancelled = false;
    let isFetching = false;

    async function pollRemotionUrl() {
      if (isFetching) {
        return;
      }

      isFetching = true;

      try {
        await fetchRemotionUrl(false);
      } catch (error) {
        if (!isCancelled) {
          setLastError(error instanceof Error ? error.message : "Remotion URL check failed");
        }
      } finally {
        isFetching = false;
      }
    }

    void pollRemotionUrl();
    const interval = window.setInterval(pollRemotionUrl, POLL_INTERVAL_MS);

    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <article className="workspace-status-card" id="remotion-avatar">
      <div className="workspace-status-card__header">
        <div>
          <p className="workspace-status-card__eyebrow">Remotion AI Assistant</p>
          <h2>AI Assistant runtime output</h2>
        </div>
        <span className={`project-status project-status--${isReady ? "ready" : status === "stale" ? "failed" : "running"}`}>
          {isReady ? "ready" : status === "stale" ? "stale" : "processing"}
        </span>
      </div>
      <p className="workspace-status-card__copy">
        Review the public AI Assistant URL after setup finishes and use it as the dashboard access point for Remotion output.
      </p>
      <dl className="workspace-status-list">
        <div>
          <dt>AI Assistant</dt>
          <dd>{avatarName ?? "Not named yet"}</dd>
        </div>
        <div>
          <dt>Public URL</dt>
          <dd>{remotionUrl || "Still waiting for Remotion to publish a URL"}</dd>
        </div>
      </dl>
      {isPaused ? (
        <p className="workspace-status-card__paused" role="alert">
          <AlertTriangle aria-hidden="true" size={16} strokeWidth={1.9} />
          <span>
            OpenClaw AI usage is paused, so the Remotion URL check is skipped.{" "}
            <a href="/dashboard/settings?tab=general&openclawAi=paused">Resume AI usage in Settings</a> to continue.
          </span>
        </p>
      ) : null}
      {lastError && !isPaused ? <p className="workspace-status-card__hint">Remotion URL check: {lastError}</p> : null}
      <div className="workspace-status-actions">
        {remotionUrl ? (
          <a className="btn-primary" href={remotionUrl} rel="noreferrer" target="_blank">
            Open Remotion AI Assistant <span className="arrow">-&gt;</span>
          </a>
        ) : (
          <span aria-disabled="true" className="btn-primary is-disabled" role="link">
            Waiting for Remotion URL
          </span>
        )}
        <button className="btn-ghost" disabled={isRefreshing} onClick={refreshNow} type="button">
          <RefreshCw className={isRefreshing ? "spin-icon" : undefined} size={16} strokeWidth={1.8} />
          {isRefreshing ? "Refreshing..." : "Refresh URL"}
        </button>
      </div>
    </article>
  );
}
