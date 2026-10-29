"use client";

import { Localized, LocalizedMessage } from "@/components/language-provider";


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
          <p className="workspace-status-card__eyebrow"><Localized en={"Remotion AI Assistant"} zh={"Remotion AI 助手"} /></p>
          <h2><Localized en={"AI Assistant runtime output"} zh={"AI 助手运行输出"} /></h2>
        </div>
        <span className={`project-status project-status--${isReady ? "ready" : status === "stale" ? "failed" : "running"}`}>
          {isReady ? <Localized en={"ready"} zh={"已就绪"} /> : status === "stale" ? <Localized en={"stale"} zh={"已过期"} /> : <Localized en={"processing"} zh={"处理中"} />}
        </span>
      </div>
      <p className="workspace-status-card__copy">
        <Localized en={"Review the public AI Assistant URL after setup finishes and use it as the dashboard access point for Remotion output."} zh={"设置完成后查看 AI 助手的公共地址，并用它从工作台访问 Remotion 输出。"} /></p>
      <dl className="workspace-status-list">
        <div>
          <dt><Localized en={"AI Assistant"} zh={"AI 助手"} /></dt>
          <dd>{avatarName ?? <Localized en="Not named yet" zh="尚未命名" />}</dd>
        </div>
        <div>
          <dt><Localized en={"Public URL"} zh={"公共地址"} /></dt>
          <dd>{remotionUrl || "Still waiting for Remotion to publish a URL"}</dd>
        </div>
      </dl>
      {isPaused ? (
        <p className="workspace-status-card__paused" role="alert">
          <AlertTriangle aria-hidden="true" size={16} strokeWidth={1.9} />
          <span>
            <Localized en={"AI Agent usage is paused, so the Remotion URL check is skipped."} zh={"AI Agent 用量已暂停，因此跳过 Remotion 地址检查。"} />{" "}
            <a href="/dashboard/settings?tab=general&openclawAi=paused"><Localized en={"Resume AI usage in Settings"} zh={"在设置中恢复 AI 用量"} /></a> <Localized en="to continue." zh="以继续。" />
          </span>
        </p>
      ) : null}
      {lastError && !isPaused ? <p className="workspace-status-card__hint"><Localized en={"Remotion URL check:"} zh={"Remotion 地址检查："} />{" "}<LocalizedMessage text={lastError} /></p> : null}
      <div className="workspace-status-actions">
        {remotionUrl ? (
          <a className="btn-primary" href={remotionUrl} rel="noreferrer" target="_blank">
            <Localized en={"Open Remotion AI Assistant"} zh={"打开 Remotion AI 助手"} /><span className="arrow">-&gt;</span>
          </a>
        ) : (
          <span aria-disabled="true" className="btn-primary is-disabled" role="link">
            <Localized en={"Waiting for Remotion URL"} zh={"正在等待 Remotion 地址"} /></span>
        )}
        <button className="btn-ghost" disabled={isRefreshing} onClick={refreshNow} type="button">
          <RefreshCw className={isRefreshing ? "spin-icon" : undefined} size={16} strokeWidth={1.8} />
          {isRefreshing ? <Localized en={"Refreshing..."} zh={"正在刷新..."} /> : <Localized en={"Refresh URL"} zh={"刷新地址"} />}
        </button>
      </div>
    </article>
  );
}
