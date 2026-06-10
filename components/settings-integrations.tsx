"use client";

import { useEffect, useRef, useState } from "react";
import {
  BriefcaseBusiness,
  CheckCircle2,
  ChartNoAxesColumnIncreasing,
  NotebookTabs,
  Music2,
  Share2,
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
  status?: string;
  state?: string;
};

type GoogleWorkspaceAuthPhase = "idle" | "starting" | "waiting" | "ready" | "failed";

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

function openGoogleWorkspacePopup() {
  const width = 560;
  const height = 720;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  const features = [
    "popup=yes",
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    "resizable=yes",
    "scrollbars=yes",
    "toolbar=no",
    "menubar=no",
    "status=no"
  ].join(",");
  const loginWindow = window.open("about:blank", "2ndbrain-google-workspace-auth", features);

  loginWindow?.focus();

  return loginWindow;
}

export function SettingsIntegrations({
  initialGoogleWorkspaceAuthPrompt = false,
  initialGoogleWorkspaceEnabled = false
}: SettingsIntegrationsProps) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    "google-workspace": initialGoogleWorkspaceEnabled
  });
  const [googleWorkspaceAuthMessage, setGoogleWorkspaceAuthMessage] = useState<string | null>(null);
  const [googleWorkspaceAuthPhase, setGoogleWorkspaceAuthPhase] = useState<GoogleWorkspaceAuthPhase>("idle");
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
    const loginWindow = openGoogleWorkspacePopup();

    void startGoogleWorkspaceAuth({
      loginWindow,
      redirectCurrent: !loginWindow
    });
  }, [initialGoogleWorkspaceAuthPrompt, googleWorkspaceEnabled]);

  async function startGoogleWorkspaceAuth(options: { loginWindow?: Window | null; redirectCurrent?: boolean } = {}) {
    let loginWindow = options.loginWindow ?? null;

    try {
      setGoogleWorkspaceAuthMessage(null);
      setGoogleWorkspaceAuthPhase("starting");

      const data = await postGoogleWorkspaceAuth("/api/openclaw/gws-auth/start");
      const nextUrl = data.authUrl?.trim() || null;

      if (!nextUrl) {
        loginWindow?.close();
        throw new Error(data.error || "Google Workspace login URL was not returned.");
      }

      googleWorkspaceAuthState.current = data.state?.trim() || null;
      setGoogleWorkspaceAuthPhase("waiting");
      setGoogleWorkspaceAuthMessage("Google login opened. This page will confirm when OpenClaw receives credentials.");

      if (loginWindow) {
        loginWindow.location.href = nextUrl;
      } else if (options.redirectCurrent) {
        window.location.href = nextUrl;
      }
    } catch (error) {
      loginWindow?.close();
      setGoogleWorkspaceAuthPhase("failed");
      setGoogleWorkspaceAuthMessage(error instanceof Error ? error.message : "Google Workspace login could not start.");
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
      googleWorkspaceLoginWindow = openGoogleWorkspacePopup();
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
        await startGoogleWorkspaceAuth({
          loginWindow: googleWorkspaceLoginWindow,
          redirectCurrent: !googleWorkspaceLoginWindow
        });
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
              {integration.id === "google-workspace" && isEnabled && (googleWorkspaceAuthPhase !== "idle" || googleWorkspaceAuthMessage) ? (
                <div className="claude-auth-card google-workspace-auth-card">
                  {googleWorkspaceAuthPhase === "starting" || googleWorkspaceAuthPhase === "waiting" ? (
                    <progress aria-label="Google Workspace auth progress" className="settings-dialog__progress" />
                  ) : null}

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
