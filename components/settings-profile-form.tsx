"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";

type SettingsProfileFormProps = {
  initialProfileName?: string | null;
  userEmail?: string | null;
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

export function SettingsProfileForm({ initialProfileName = "", userEmail = null }: SettingsProfileFormProps) {
  const [profileName, setProfileName] = useState(initialProfileName?.trim() ?? "");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const accountEmail = userEmail?.trim() || "Not available";

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
      setProfileStatus("Profile name saved and Gyne consumer updated.");
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
        <h3>Account profile</h3>
        <p>View the sign-in email and save the display name used for this workspace profile.</p>
      </div>
      <div className="settings-profile-card__fields">
        <div className="settings-profile-card__email">
          <span>Email address</span>
          <strong>{accountEmail}</strong>
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
      </div>
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
