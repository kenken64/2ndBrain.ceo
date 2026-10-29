"use client";

import { Localized } from "@/components/language-provider";


import { useEffect, useState } from "react";

type GatewayPayload = {
  gatewayUrl?: string | null;
};

type OpenClawGatewayButtonProps = {
  initialGatewayUrl?: string | null;
};

const POLL_INTERVAL_MS = 10_000;

export function OpenClawGatewayButton({ initialGatewayUrl }: OpenClawGatewayButtonProps) {
  const [gatewayUrl, setGatewayUrl] = useState(initialGatewayUrl?.trim() || "");

  useEffect(() => {
    if (gatewayUrl) {
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

        if (!isCancelled && response.ok && payload?.gatewayUrl) {
          setGatewayUrl(payload.gatewayUrl);
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
  }, [gatewayUrl]);

  if (gatewayUrl) {
    return (
      <a className="btn-primary" href={gatewayUrl} rel="noreferrer" target="_blank">
        <Localized en={"Open Gateway"} zh={"打开网关"} /></a>
    );
  }

  return <span className="btn-ghost is-disabled"><Localized en={"Waiting for Gateway URL"} zh={"正在等待网关地址"} /></span>;
}
