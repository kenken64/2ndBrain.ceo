"use client";

import { Localized, LocalizedMessage, useLanguage } from "@/components/language-provider";


import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

type GatewayPayload = {
  code?: string;
  error?: string;
  gatewayUrl?: string | null;
  status?: string;
};

type PublicIpPayload = {
  code?: string;
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
  const zh = useLanguage().language === "zh";
  const [gatewayUrl, setGatewayUrl] = useState(initialGatewayUrl?.trim() || "");
  const [lastError, setLastError] = useState("");
  const instanceAddress = instance?.trim() || "";
  const [publicIp, setPublicIp] = useState(isIpAddress(instanceAddress) ? instanceAddress : "");
  const [publicIpError, setPublicIpError] = useState("");
  const [isPublicIpVisible, setIsPublicIpVisible] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const hasInstance = Boolean(instanceAddress);
  const isReady = Boolean(gatewayUrl);
  const hiddenPublicIpValue = publicIp ? "**** **** ****" : hasInstance ? (zh ? "正在解析公共 IP" : "Resolving public IP") : (zh ? "尚不可用" : "Not available yet");

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
          setIsPaused(false);
          return;
        }

        if (response.status === 423 || payload?.code === "openclaw_tokens_paused") {
          setIsPaused(true);
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
          setIsPaused(false);
          return;
        }

        if (response.status === 423 || payload?.code === "openclaw_tokens_paused") {
          setIsPaused(true);
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
          <p className="workspace-status-card__eyebrow"><Localized en={"AI Agent Gateway UI"} zh={"AI Agent 网关界面"} /></p>
          <h2><Localized en={"Gateway entry point"} zh={"网关入口"} /></h2>
        </div>
        <span className={`project-status project-status--${isReady ? "ready" : hasInstance ? "running" : "draft"}`}>
          {isReady ? <Localized en={"ready"} zh={"已就绪"} /> : hasInstance ? <Localized en={"checking"} zh={"检查中"} /> : <Localized en={"pending"} zh={"待处理"} />}
        </span>
      </div>
      <p className="workspace-status-card__copy">
        <Localized en={"Launch the AI Agent workspace through its Tailscale Funnel public HTTPS URL."} zh={"通过 Tailscale Funnel 的公共 HTTPS 地址启动 AI Agent 工作空间。"} /></p>
      <dl className="workspace-status-list">
        <div>
          <dt><Localized en={"AI Agent IP address"} zh={"AI Agent IP 地址"} /></dt>
          <dd className="workspace-secret-field">
            <span>{isPublicIpVisible ? publicIp : hiddenPublicIpValue}</span>
            {publicIp ? (
              <button
                aria-label={zh ? (isPublicIpVisible ? "隐藏 AI Agent IP 地址" : "显示 AI Agent IP 地址") : (isPublicIpVisible ? "Hide AI Agent IP address" : "Show AI Agent IP address")}
                className="workspace-secret-toggle"
                onClick={() => setIsPublicIpVisible((current) => !current)}
                type="button"
              >
                {isPublicIpVisible ? <Localized en={"Hide"} zh={"隐藏"} /> : <Localized en={"Show"} zh={"显示"} />}
              </button>
            ) : null}
          </dd>
        </div>
        <div>
          <dt><Localized en={"Tailscale Funnel URL"} zh={"Tailscale Funnel 地址"} /></dt>
          <dd>{gatewayUrl || (zh ? "正在等待 Tailscale Funnel 发布地址" : "Waiting for Tailscale Funnel to publish the URL")}</dd>
        </div>
        <div>
          <dt><Localized en={"Launch mode"} zh={"启动模式"} /></dt>
          <dd>{gatewayUrl ? <Localized en={"Tailscale Funnel public HTTPS URL"} zh={"Tailscale Funnel 公共 HTTPS 地址"} /> : <Localized en={"Polling every 10 seconds until available"} zh={"每 10 秒检查一次，直到可用"} />}</dd>
        </div>
      </dl>
      {isPaused ? (
        <p className="workspace-status-card__paused" role="alert">
          <AlertTriangle aria-hidden="true" size={16} strokeWidth={1.9} />
          <span>
            <Localized en={"AI Agent usage is paused, so gateway checks are skipped."} zh={"AI Agent 用量已暂停，因此跳过网关检查。"} />{" "}
            <a href="/dashboard/settings?tab=general&openclawAi=paused"><Localized en={"Resume AI usage in Settings"} zh={"在设置中恢复 AI 用量"} /></a> <Localized en="to continue." zh="以继续。" />
          </span>
        </p>
      ) : null}
      {publicIpError && !publicIp && !isPaused ? <p className="workspace-status-card__hint"><Localized en={"IP check:"} zh={"IP 检查："} />{" "}<LocalizedMessage text={publicIpError} /></p> : null}
      {lastError && !gatewayUrl && !isPaused ? <p className="workspace-status-card__hint"><Localized en={"Last check:"} zh={"上次检查："} />{" "}<LocalizedMessage text={lastError} /></p> : null}
      <div className="workspace-status-actions">
        <a className="btn-primary" href="/dashboard/openclaw">
          <Localized en={"Open AI Agent section"} zh={"打开 AI Agent 页面"} /><span className="arrow">-&gt;</span>
        </a>
        {gatewayUrl ? (
          <a className="text-link" href={gatewayUrl} rel="noreferrer" target="_blank">
            <Localized en={"Open Tailscale Gateway ->"} zh={"打开 Tailscale 网关 →"} /></a>
        ) : (
          <span className="text-link is-disabled"><Localized en={"Waiting for gateway URL"} zh={"正在等待网关地址"} /></span>
        )}
      </div>
    </article>
  );
}
