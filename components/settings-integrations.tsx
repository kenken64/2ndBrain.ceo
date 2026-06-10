"use client";

import { useEffect, useRef, useState } from "react";
import {
  BriefcaseBusiness,
  CheckCircle2,
  ChartNoAxesColumnIncreasing,
  ExternalLink,
  NotebookTabs,
  Music2,
  RefreshCw,
  Share2,
  ShieldCheck,
  Users
} from "lucide-react";

type Integration = {
  copy: string;
  icon: typeof BriefcaseBusiness;
  id: string;
  label: string;
  name: string;
  note: string;
};

const integrations: Integration[] = [
  {
    copy: "Connect Drive, Docs, Sheets, Calendar, and Gmail as workspace knowledge sources.",
    icon: BriefcaseBusiness,
    id: "google-workspace",
    label: "Google Workspace",
    name: "Connect Google Workspace",
    note: "Installs GWS OAuth credentials onto the current OpenClaw instance."
  },
  {
    copy: "Prepare Facebook Ads access for campaign reporting, lead intake, and audience performance notes.",
    icon: Users,
    id: "facebook-ads",
    label: "Facebook Ads",
    name: "Enable Facebook advertising",
    note: "Meta OAuth and Marketing API permissions should be added before live campaign sync."
  },
  {
    copy: "Prepare LinkedIn Ads access for B2B campaign insights, lead-gen forms, and account targeting context.",
    icon: ChartNoAxesColumnIncreasing,
    id: "linkedin-ads",
    label: "LinkedIn Ads",
    name: "Enable LinkedIn advertising",
    note: "LinkedIn OAuth and Ads API permissions should be added before live campaign sync."
  },
  {
    copy: "Prepare Instagram Ads access for creative performance, audience notes, and social campaign memory.",
    icon: Share2,
    id: "instagram-ads",
    label: "Instagram Ads",
    name: "Enable Instagram advertising",
    note: "Instagram is usually connected through Meta Business APIs and should share the Meta OAuth flow."
  },
  {
    copy: "Prepare TikTok Ads access for short-form creative testing, ad groups, and conversion reporting.",
    icon: Music2,
    id: "tiktok-ads",
    label: "TikTok Ads",
    name: "Enable TikTok advertising",
    note: "TikTok Business OAuth and Ads API permissions should be added before live campaign sync."
  },
  {
    copy: "Prepare Xiaohongshu access for China social commerce notes, creator campaigns, and lifestyle content performance.",
    icon: NotebookTabs,
    id: "xiaohongshu-ads",
    label: "Xiaohongshu Ads",
    name: "Enable Xiaohongshu advertising",
    note: "Xiaohongshu business account auth and ad/reporting APIs should be added before live campaign sync."
  }
];

type SettingsIntegrationsProps = {
  initialGoogleWorkspaceAuthPrompt?: boolean;
  initialGoogleWorkspaceEnabled?: boolean;
};

type SavePayload = {
  googleWorkspaceEnabled?: boolean;
};

async function saveProfileSettings(payload: SavePayload) {
  const response = await fetch("/api/settings/profile", {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json"
    },
    method: "PATCH"
  });
  const data = (await response.json().catch(() => null)) as
    | {
        error?: string;
        googleWorkspaceEnabled?: boolean;
        profileName?: string;
      }
    | null;

  if (!response.ok) {
    throw new Error(data?.error ?? "Settings could not be saved.");
  }

  return data;
}

type GoogleWorkspaceAuthResponse = {
  authUrl?: string | null;
  error?: string;
  ok?: boolean;
  redirectUri?: string;
  source?: string;
  status?: string;
  state?: string;
};

type GoogleWorkspaceAuthPhase = "idle" | "starting" | "waiting" | "submitting" | "ready" | "failed";

type GoogleWorkspaceAuthResultMessage = {
  message?: string;
  state?: string;
  status?: string;
};

async function postGoogleWorkspaceAuth(path: string, payload?: Record<string, unknown>) {
  const response = await fetch(path, {
    body: payload ? JSON.stringify(payload) : undefined,
    headers: payload
      ? {
          "Content-Type": "application/json"
        }
      : undefined,
    method: "POST"
  });
  const data = (await response.json().catch(() => null)) as GoogleWorkspaceAuthResponse | null;

  if (!response.ok) {
    throw new Error(data?.error ?? "Google Workspace auth request failed.");
  }

  return data ?? {};
}

export function SettingsIntegrations({
  initialGoogleWorkspaceAuthPrompt = false,
  initialGoogleWorkspaceEnabled = false
}: SettingsIntegrationsProps) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    "google-workspace": initialGoogleWorkspaceEnabled
  });
  const [googleWorkspaceAuthInput, setGoogleWorkspaceAuthInput] = useState("");
  const [googleWorkspaceAuthMessage, setGoogleWorkspaceAuthMessage] = useState<string | null>(null);
  const [googleWorkspaceAuthPhase, setGoogleWorkspaceAuthPhase] = useState<GoogleWorkspaceAuthPhase>("idle");
  const [googleWorkspaceAuthUrl, setGoogleWorkspaceAuthUrl] = useState<string | null>(null);
  const [integrationError, setIntegrationError] = useState<string | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<string | null>(null);
  const [savingIntegration, setSavingIntegration] = useState<string | null>(null);
  const googleWorkspaceAuthState = useRef<string | null>(null);
  const promptedGoogleWorkspaceAuth = useRef(false);

  const googleWorkspaceEnabled = Boolean(enabled["google-workspace"]);

  useEffect(() => {
    function applyAuthResult(payload: unknown) {
      if (!payload || typeof payload !== "object") {
        return;
      }

      const data = payload as GoogleWorkspaceAuthResultMessage;

      if (data.state && googleWorkspaceAuthState.current && data.state !== googleWorkspaceAuthState.current) {
        return;
      }

      if (data.status === "connected") {
        googleWorkspaceAuthState.current = null;
        setGoogleWorkspaceAuthInput("");
        setGoogleWorkspaceAuthPhase("ready");
        setGoogleWorkspaceAuthMessage(data.message || "Google Workspace OAuth is installed on OpenClaw.");
        return;
      }

      if (data.status === "failed") {
        setGoogleWorkspaceAuthPhase("failed");
        setGoogleWorkspaceAuthMessage(data.message || "Google Workspace auth could not be completed.");
      }
    }

    function handleWindowMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) {
        return;
      }

      applyAuthResult(event.data);
    }

    let channel: BroadcastChannel | null = null;

    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel("2ndbrain:gws-auth");
      channel.onmessage = (event) => applyAuthResult(event.data);
    }

    window.addEventListener("message", handleWindowMessage);

    return () => {
      channel?.close();
      window.removeEventListener("message", handleWindowMessage);
    };
  }, []);

  useEffect(() => {
    if (!initialGoogleWorkspaceAuthPrompt || !googleWorkspaceEnabled || promptedGoogleWorkspaceAuth.current) {
      return;
    }

    promptedGoogleWorkspaceAuth.current = true;
    void startGoogleWorkspaceAuth({ openPopup: false });
  }, [initialGoogleWorkspaceAuthPrompt, googleWorkspaceEnabled]);

  async function startGoogleWorkspaceAuth(options: { loginWindow?: Window | null; openPopup?: boolean } = {}) {
    let loginWindow = options.loginWindow ?? null;

    if (!loginWindow && options.openPopup) {
      loginWindow = window.open("about:blank", "_blank");
    }

    try {
      if (loginWindow) {
        loginWindow.opener = null;
      }

      setGoogleWorkspaceAuthMessage(null);
      setGoogleWorkspaceAuthPhase("starting");

      const data = await postGoogleWorkspaceAuth("/api/openclaw/gws-auth/start");
      const nextUrl = data.authUrl?.trim() || null;

      if (!nextUrl) {
        loginWindow?.close();
        throw new Error(data.error || "Google Workspace login URL was not returned.");
      }

      setGoogleWorkspaceAuthUrl(nextUrl);
      googleWorkspaceAuthState.current = data.state?.trim() || null;
      setGoogleWorkspaceAuthPhase("waiting");
      setGoogleWorkspaceAuthMessage("Google login opened. This page will confirm when OpenClaw receives credentials.");

      if (loginWindow) {
        loginWindow.location.href = nextUrl;
      }
    } catch (error) {
      loginWindow?.close();
      setGoogleWorkspaceAuthPhase("failed");
      setGoogleWorkspaceAuthMessage(error instanceof Error ? error.message : "Google Workspace login could not start.");
    }
  }

  async function submitGoogleWorkspaceAuth() {
    const input = googleWorkspaceAuthInput.trim();

    if (!input) {
      setGoogleWorkspaceAuthPhase("failed");
      setGoogleWorkspaceAuthMessage("Paste the localhost callback URL, authorization code, or exported GWS credentials JSON.");
      return;
    }

    setGoogleWorkspaceAuthMessage(null);
    setGoogleWorkspaceAuthPhase("submitting");

    try {
      const payload = input.startsWith("{")
        ? { credentialsJson: input }
        : { callbackUrl: input };
      const data = await postGoogleWorkspaceAuth("/api/openclaw/gws-auth/login", payload);

      googleWorkspaceAuthState.current = null;
      setGoogleWorkspaceAuthInput("");
      setGoogleWorkspaceAuthPhase("ready");
      setGoogleWorkspaceAuthMessage(
        data.source === "oauth_code"
          ? "Google Workspace OAuth is installed on OpenClaw."
          : "Google Workspace credentials are installed on OpenClaw."
      );
    } catch (error) {
      setGoogleWorkspaceAuthPhase("failed");
      setGoogleWorkspaceAuthMessage(error instanceof Error ? error.message : "Google Workspace auth could not be completed.");
    }
  }

  async function handleToggle(integrationId: string) {
    const nextEnabled = !enabled[integrationId];
    let googleWorkspaceLoginWindow: Window | null = null;

    if (integrationId !== "google-workspace") {
      setEnabled((current) => ({
        ...current,
        [integrationId]: nextEnabled
      }));
      return;
    }

    if (nextEnabled) {
      googleWorkspaceLoginWindow = window.open("about:blank", "_blank");
    }

    setIntegrationError(null);
    setIntegrationStatus(null);
    setSavingIntegration(integrationId);
    setEnabled((current) => ({
      ...current,
      [integrationId]: nextEnabled
    }));

    try {
      const saved = await saveProfileSettings({ googleWorkspaceEnabled: nextEnabled });
      setEnabled((current) => ({
        ...current,
        [integrationId]: Boolean(saved?.googleWorkspaceEnabled)
      }));
      setIntegrationStatus(`Google Workspace ${nextEnabled ? "enabled" : "disabled"}.`);

      if (nextEnabled && saved?.googleWorkspaceEnabled) {
        await startGoogleWorkspaceAuth({ loginWindow: googleWorkspaceLoginWindow });
        googleWorkspaceLoginWindow = null;
      }
    } catch (error) {
      googleWorkspaceLoginWindow?.close();
      setEnabled((current) => ({
        ...current,
        [integrationId]: !nextEnabled
      }));
      setIntegrationError(error instanceof Error ? error.message : "Google Workspace setting could not be saved.");
    } finally {
      setSavingIntegration(null);
    }
  }

  return (
    <section className="settings-integrations" aria-labelledby="settings-integrations-title">
      <div className="settings-integrations__header">
        <p className="workspace-status-card__eyebrow">Integrations</p>
        <h2 id="settings-integrations-title">Connected data and advertising channels</h2>
        <p>Enable the channels you want this workspace to support. Backend OAuth and sync jobs can be wired per platform after the product flow is confirmed.</p>
      </div>
      {integrationStatus ? (
        <div className="settings-toggle-card__status">
          <CheckCircle2 size={16} strokeWidth={1.8} />
          {integrationStatus}
        </div>
      ) : null}
      {integrationError ? <p className="form-error" role="alert">{integrationError}</p> : null}

      <div className="settings-integrations__grid">
        {integrations.map((integration) => {
          const Icon = integration.icon;
          const isEnabled = Boolean(enabled[integration.id]);
          const isSaving = savingIntegration === integration.id;

          return (
            <div className="settings-toggle-card" key={integration.id}>
              <div className="settings-toggle-card__icon" aria-hidden="true">
                <Icon size={24} strokeWidth={1.8} />
              </div>
              <div className="settings-toggle-card__body">
                <p className="workspace-status-card__eyebrow">{integration.label}</p>
                <h3>{integration.name}</h3>
                <p>{integration.copy}</p>
                <p className="settings-toggle-card__note">{integration.note}</p>
              </div>
              <button
                aria-checked={isEnabled}
                aria-label={`${isEnabled ? "Disable" : "Enable"} ${integration.label}`}
                className={`settings-switch${isEnabled ? " is-enabled" : ""}`}
                disabled={isSaving}
                onClick={() => handleToggle(integration.id)}
                role="switch"
                type="button"
              >
                <span />
              </button>
              {integration.id === "google-workspace" && isEnabled ? (
                <div className="claude-auth-card google-workspace-auth-card">
                  <div className="claude-auth-card__actions">
                    <button
                      className="settings-action-button settings-action-button--telegram"
                      disabled={googleWorkspaceAuthPhase === "starting" || googleWorkspaceAuthPhase === "submitting"}
                      onClick={() => startGoogleWorkspaceAuth({ openPopup: true })}
                      type="button"
                    >
                      {googleWorkspaceAuthPhase === "starting" ? (
                        <>
                          <RefreshCw className="spin-icon" size={16} strokeWidth={2} />
                          Starting...
                        </>
                      ) : (
                        <>
                          <ShieldCheck size={16} strokeWidth={2} />
                          Open Google login
                        </>
                      )}
                    </button>
                    <button
                      className="btn-ghost btn-ghost--compact"
                      disabled={googleWorkspaceAuthPhase === "submitting"}
                      onClick={submitGoogleWorkspaceAuth}
                      type="button"
                    >
                      Install pasted credentials
                    </button>
                  </div>

                  {googleWorkspaceAuthPhase === "starting" || googleWorkspaceAuthPhase === "submitting" ? (
                    <progress aria-label="Google Workspace auth progress" className="settings-dialog__progress" />
                  ) : null}

                  {googleWorkspaceAuthUrl ? (
                    <a className="claude-auth-card__link" href={googleWorkspaceAuthUrl} rel="noreferrer" target="_blank">
                      <ExternalLink size={16} strokeWidth={2} />
                      Open Google login URL
                    </a>
                  ) : null}

                  <textarea
                    aria-label="Google Workspace callback URL or credentials JSON"
                    className="google-workspace-auth-card__input"
                    onChange={(event) => setGoogleWorkspaceAuthInput(event.target.value)}
                    placeholder="Optional callback code or exported credentials JSON"
                    rows={4}
                    value={googleWorkspaceAuthInput}
                  />

                  {googleWorkspaceAuthMessage ? (
                    <p
                      aria-live="polite"
                      className={`claude-auth-card__message${googleWorkspaceAuthPhase === "failed" ? " claude-auth-card__message--error" : ""}`}
                    >
                      {googleWorkspaceAuthMessage}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {isEnabled || isSaving ? (
                <div className="settings-toggle-card__status">
                  <CheckCircle2 size={16} strokeWidth={1.8} />
                  {isSaving ? `Saving ${integration.label}...` : `${integration.label} enabled`}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
