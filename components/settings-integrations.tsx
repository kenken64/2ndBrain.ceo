"use client";

import { useState } from "react";
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
    note: "OAuth scopes and sync jobs are not wired yet. This switch prepares the product state."
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

export function SettingsIntegrations({
  initialGoogleWorkspaceEnabled = false
}: SettingsIntegrationsProps) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    "google-workspace": initialGoogleWorkspaceEnabled
  });
  const [integrationError, setIntegrationError] = useState<string | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<string | null>(null);
  const [savingIntegration, setSavingIntegration] = useState<string | null>(null);

  async function handleToggle(integrationId: string) {
    const nextEnabled = !enabled[integrationId];

    if (integrationId !== "google-workspace") {
      setEnabled((current) => ({
        ...current,
        [integrationId]: nextEnabled
      }));
      return;
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
    } catch (error) {
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
