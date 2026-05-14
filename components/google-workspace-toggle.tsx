"use client";

import { useState } from "react";
import { BriefcaseBusiness, CheckCircle2 } from "lucide-react";

export function GoogleWorkspaceToggle() {
  const [isEnabled, setIsEnabled] = useState(false);

  return (
    <div className="settings-toggle-card">
      <div className="settings-toggle-card__icon" aria-hidden="true">
        <BriefcaseBusiness size={24} strokeWidth={1.8} />
      </div>
      <div className="settings-toggle-card__body">
        <p className="workspace-status-card__eyebrow">Google Workspace</p>
        <h2>Connect Google Workspace</h2>
        <p>
          Enable this when you are ready to connect Google Workspace data such as Drive, Docs, Sheets, Calendar, and Gmail to this workspace.
        </p>
        <p className="settings-toggle-card__note">
          OAuth scopes and sync jobs are not wired yet. This switch prepares the product state; the actual Google connection route should be added next.
        </p>
      </div>
      <button
        aria-checked={isEnabled}
        aria-label="Enable Google Workspace connection"
        className={`settings-switch${isEnabled ? " is-enabled" : ""}`}
        onClick={() => setIsEnabled((current) => !current)}
        role="switch"
        type="button"
      >
        <span />
      </button>
      {isEnabled ? (
        <div className="settings-toggle-card__status">
          <CheckCircle2 size={16} strokeWidth={1.8} />
          Google Workspace connector enabled
        </div>
      ) : null}
    </div>
  );
}
