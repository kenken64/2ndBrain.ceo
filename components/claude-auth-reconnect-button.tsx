"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";

type ClaudeAuthResponse = {
  authenticated?: boolean;
  authUrl?: string | null;
  error?: string;
  message?: string | null;
  status?: string;
};

type Phase = "idle" | "starting" | "waiting" | "ready" | "failed";

async function postJson(path: string) {
  const response = await fetch(path, {
    method: "POST"
  });
  const data = (await response.json().catch(() => null)) as ClaudeAuthResponse | null;

  if (!response.ok) {
    throw new Error(data?.error ?? "Claude auth request failed.");
  }

  return data ?? {};
}

export function ClaudeAuthReconnectButton() {
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const pollAttempts = useRef(0);

  const isBusy = phase === "starting" || phase === "waiting";

  useEffect(() => {
    if (phase !== "waiting") {
      return;
    }

    let cancelled = false;

    async function poll() {
      pollAttempts.current += 1;

      try {
        const data = await postJson("/api/openclaw/claude-auth/status");

        if (cancelled) {
          return;
        }

        if (data.authenticated) {
          setPhase("ready");
          setMessage("Claude auth is active on the OpenClaw instance.");
          return;
        }

        setMessage(data.message || "Waiting for Claude login to complete.");

        if (pollAttempts.current >= 72) {
          setPhase("failed");
          setMessage("Claude login was not confirmed after 6 minutes. Start the reconnect flow again if needed.");
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        setPhase("failed");
        setMessage(error instanceof Error ? error.message : "Claude auth status check failed.");
      }
    }

    poll();
    const interval = window.setInterval(poll, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [phase]);

  async function startReconnect() {
    setAuthUrl(null);
    setMessage(null);
    setPhase("starting");
    pollAttempts.current = 0;

    const loginWindow = window.open("about:blank", "_blank");

    try {
      if (loginWindow) {
        loginWindow.opener = null;
      }

      const data = await postJson("/api/openclaw/claude-auth/start");
      const nextUrl = data.authUrl?.trim() || null;

      if (!nextUrl) {
        loginWindow?.close();
        throw new Error(data.message || "clawmacdo did not return a Claude login URL.");
      }

      setAuthUrl(nextUrl);
      setPhase("waiting");
      setMessage("Claude login opened. Complete the browser flow, then this page will confirm the connection.");

      if (loginWindow) {
        loginWindow.location.href = nextUrl;
      }
    } catch (error) {
      loginWindow?.close();
      setPhase("failed");
      setMessage(error instanceof Error ? error.message : "Claude reconnect failed.");
    }
  }

  async function checkNow() {
    setMessage(null);

    try {
      const data = await postJson("/api/openclaw/claude-auth/status");

      if (data.authenticated) {
        setPhase("ready");
        setMessage("Claude auth is active on the OpenClaw instance.");
        return;
      }

      setPhase("waiting");
      setMessage(data.message || "Claude login is still pending.");
    } catch (error) {
      setPhase("failed");
      setMessage(error instanceof Error ? error.message : "Claude auth status check failed.");
    }
  }

  return (
    <div className="claude-auth-card">
      <div className="claude-auth-card__actions">
        <button className="settings-action-button settings-action-button--telegram" disabled={isBusy} onClick={startReconnect} type="button">
          {phase === "starting" ? (
            <>
              <RefreshCw className="spin-icon" size={16} strokeWidth={2} />
              Starting...
            </>
          ) : (
            <>
              <ShieldCheck size={16} strokeWidth={2} />
              Reconnect Claude
            </>
          )}
        </button>
        <button className="btn-ghost btn-ghost--compact" disabled={phase === "starting"} onClick={checkNow} type="button">
          Check status
        </button>
      </div>

      {isBusy ? <progress aria-label="Claude auth progress" className="settings-dialog__progress" /> : null}

      {authUrl ? (
        <a className="claude-auth-card__link" href={authUrl} rel="noreferrer" target="_blank">
          <ExternalLink size={16} strokeWidth={2} />
          Open Claude login
        </a>
      ) : null}

      {message ? (
        <p
          aria-live="polite"
          className={`claude-auth-card__message${phase === "failed" ? " claude-auth-card__message--error" : ""}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
