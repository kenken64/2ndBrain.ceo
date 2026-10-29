"use client";

import { Localized, useLanguage, LocalizedMessage } from "@/components/language-provider";


import { navigateToPage } from "@/lib/page-navigation";

import { useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";

type DestroyWorkspaceButtonProps = {
  variant?: "sidebar" | "panel";
};

export function DestroyWorkspaceButton({ variant = "sidebar" }: DestroyWorkspaceButtonProps) {
  const _uiLanguage = useLanguage().language;
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDestroying, setIsDestroying] = useState(false);
  const [error, setError] = useState("");
  const wrapperClassName = variant === "panel" ? "destroy-workspace destroy-workspace--panel" : "destroy-workspace";
  const buttonClassName =
    variant === "panel" ? "settings-action-button settings-action-button--danger" : "sidebar-item sidebar-item--destroy";
  const idleLabel = variant === "panel" ? "Destroy instance" : "Destroy workspace";

  async function handleDestroy() {
    if (isDestroying) {
      return;
    }

    setIsDestroying(true);
    setError("");

    try {
      const response = await fetch("/api/account/destroy-workspace", {
        credentials: "same-origin",
        method: "POST"
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Workspace reset failed");
      }

      const payload = await response.json().catch(() => null);
      navigateToPage(
        payload?.redirectTo ?? "/login?next=%2Fonboarding%3Fnext%3D%252Fdashboard%26step%3Denrolment"
      );
    } catch (destroyError) {
      setError(destroyError instanceof Error ? destroyError.message : "Workspace reset failed");
      setIsDestroying(false);
    }
  }

  return (
    <div className={wrapperClassName}>
      <button
        className={buttonClassName}
        disabled={isDestroying}
        onClick={() => setIsDialogOpen(true)}
        type="button"
      >
        {isDestroying ? <LoaderCircle className="spin-icon" size={18} strokeWidth={1.7} /> : <Trash2 size={18} strokeWidth={1.7} />}
        {isDestroying ? <Localized en={"Destroying..."} zh={"正在销毁..."} /> : idleLabel}
      </button>
      {error ? <span className="destroy-workspace__error"><LocalizedMessage text={error} /></span> : null}
      <ConfirmDialog
        busy={isDestroying}
        busyLabel="Destroying..."
        closeLabel="Close destroy workspace dialog"
        confirmLabel="Destroy and reset"
        description="This will destroy the current Cloud AI Agent instance, clear generated Nth Brain project history for this account, reset onboarding, and log you out."
        error={error}
        eyebrow="Danger zone"
        onCancel={() => setIsDialogOpen(false)}
        onConfirm={() => void handleDestroy()}
        open={isDialogOpen}
        title={_uiLanguage === "zh" ? "销毁此工作空间？" : "Destroy this workspace?"}
        warning="This action is destructive. Use it only when you want this account to return to enrolment and provision a fresh workspace."
      />
    </div>
  );
}
