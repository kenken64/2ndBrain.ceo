"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";

type SettingsProfileFormProps = {
  initialProfileName?: string | null;
};

async function saveProfileName(profileName: string) {
  const response = await fetch("/api/settings/profile", {
    body: JSON.stringify({ profileName }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "PATCH"
  });
  const data = (await response.json().catch(() => null)) as
    | {
        error?: string;
        profileName?: string;
      }
    | null;

  if (!response.ok) {
    throw new Error(data?.error ?? "Profile name could not be saved.");
  }

  return data;
}

export function SettingsProfileForm({ initialProfileName = "" }: SettingsProfileFormProps) {
  const [profileName, setProfileName] = useState(initialProfileName?.trim() ?? "");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = profileName.trim();

    setProfileError(null);
    setProfileStatus(null);

    if (!trimmed) {
      setProfileError("Profile name is required.");
      return;
    }

    setSavingProfile(true);

    try {
      const saved = await saveProfileName(trimmed);
      setProfileName(saved?.profileName ?? trimmed);
      setProfileStatus("Profile name saved.");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Profile name could not be saved.");
    } finally {
      setSavingProfile(false);
    }
  }

  return (
    <form className="settings-profile-card" noValidate onSubmit={handleProfileSubmit}>
      <div>
        <p className="workspace-status-card__eyebrow">Profile</p>
        <h3>Profile name</h3>
        <p>Save the display name used for this workspace profile.</p>
      </div>
      <label className="field-stack">
        <span>Profile name</span>
        <input
          aria-invalid={profileError ? "true" : "false"}
          disabled={savingProfile}
          maxLength={120}
          name="profileName"
          onChange={(event) => {
            setProfileName(event.target.value);
            setProfileError(null);
            setProfileStatus(null);
          }}
          placeholder="Kenneth's workspace"
          type="text"
          value={profileName}
        />
        {profileError ? <span className="field-error">{profileError}</span> : null}
      </label>
      <button className="settings-action-button settings-action-button--telegram" disabled={savingProfile} type="submit">
        {savingProfile ? "Saving..." : "Save profile"}
      </button>
      {profileStatus ? (
        <div className="settings-toggle-card__status">
          <CheckCircle2 size={16} strokeWidth={1.8} />
          {profileStatus}
        </div>
      ) : null}
    </form>
  );
}
