"use client";

import { Localized, useLanguage, LocalizedMessage } from "@/components/language-provider";

import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";

type SettingsProfileFormProps = {
  disabled?: boolean;
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

export function SettingsProfileForm({
  disabled = false,
  initialProfileName = "",
  userEmail = null
}: SettingsProfileFormProps) {
  const _uiLanguage = useLanguage().language;
  const [profileName, setProfileName] = useState(initialProfileName?.trim() ?? "");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const accountEmail = userEmail?.trim() || (_uiLanguage === "zh" ? "不可用" : "Not available");

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (disabled) {
      return;
    }

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
        <p className="workspace-status-card__eyebrow"><Localized en="Profile" zh="个人资料" /></p>
        <h3><Localized en="Account profile" zh="账户资料" /></h3>
        <p><Localized en="View the sign-in email and save the display name used for this workspace profile." zh="查看登录邮箱并保存此工作空间资料使用的显示名称。" /></p>
      </div>
      <div className="settings-profile-card__fields">
        <div className="settings-profile-card__email">
          <span><Localized en="Email address" zh="电子邮箱" /></span>
          <strong>{accountEmail}</strong>
        </div>
        <label className="field-stack">
          <span><Localized en="Profile name" zh="资料名称" /></span>
          <input
            aria-invalid={profileError ? "true" : "false"}
            disabled={disabled || savingProfile}
            maxLength={120}
            name="profileName"
            onChange={(event) => {
              setProfileName(event.target.value);
              setProfileError(null);
              setProfileStatus(null);
            }}
            placeholder={_uiLanguage === "zh" ? "您的工作空间" : "Kenneth's workspace"}
            type="text"
            value={profileName}
          />
          {profileError ? <span className="field-error"><LocalizedMessage text={profileError} /></span> : null}
        </label>
      </div>
      <button className="settings-action-button settings-action-button--telegram" disabled={disabled || savingProfile} type="submit">
        {savingProfile ? <Localized en="Saving..." zh="正在保存..." /> : <Localized en="Save profile" zh="保存资料" />}
      </button>
      {profileStatus ? (
        <div className="settings-toggle-card__status">
          <CheckCircle2 size={16} strokeWidth={1.8} />
          <LocalizedMessage text={profileStatus} />
        </div>
      ) : null}
    </form>
  );
}
