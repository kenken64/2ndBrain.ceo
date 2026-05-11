"use client";

import { useState } from "react";
import { AlertTriangle, LoaderCircle, Trash2, X } from "lucide-react";

export function DestroyWorkspaceButton() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDestroying, setIsDestroying] = useState(false);
  const [error, setError] = useState("");

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
      window.location.assign(
        payload?.redirectTo ?? "/login?next=%2Fonboarding%3Fnext%3D%252Fdashboard%26step%3Denrolment"
      );
    } catch (destroyError) {
      setError(destroyError instanceof Error ? destroyError.message : "Workspace reset failed");
      setIsDestroying(false);
    }
  }

  return (
    <div className="destroy-workspace">
      <button
        className="sidebar-item sidebar-item--destroy"
        disabled={isDestroying}
        onClick={() => setIsDialogOpen(true)}
        type="button"
      >
        {isDestroying ? <LoaderCircle className="spin-icon" size={18} strokeWidth={1.7} /> : <Trash2 size={18} strokeWidth={1.7} />}
        {isDestroying ? "Destroying..." : "Destroy workspace"}
      </button>
      {error ? <span className="destroy-workspace__error">{error}</span> : null}
      {isDialogOpen ? (
        <div className="destroy-dialog" role="presentation">
          <button
            aria-label="Close destroy workspace dialog"
            className="destroy-dialog__scrim"
            disabled={isDestroying}
            onClick={() => setIsDialogOpen(false)}
            type="button"
          />
          <section aria-labelledby="destroy-dialog-title" aria-modal="true" className="destroy-dialog__panel" role="dialog">
            <button
              aria-label="Close destroy workspace dialog"
              className="destroy-dialog__close"
              disabled={isDestroying}
              onClick={() => setIsDialogOpen(false)}
              type="button"
            >
              <X size={18} strokeWidth={1.8} />
            </button>
            <div className="destroy-dialog__icon" aria-hidden="true">
              <AlertTriangle size={28} strokeWidth={1.9} />
            </div>
            <p className="workspace-status-card__eyebrow">Danger zone</p>
            <h2 id="destroy-dialog-title">Destroy this workspace?</h2>
            <p>
              This will destroy the current Lightsail OpenClaw instance, clear generated wiki/project history for this account, reset onboarding, and log you out.
            </p>
            <div className="destroy-dialog__warning">
              This action is destructive. Use it only when you want this account to return to enrolment and provision a fresh workspace.
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="destroy-dialog__actions">
              <button className="btn-ghost" disabled={isDestroying} onClick={() => setIsDialogOpen(false)} type="button">
                Cancel
              </button>
              <button className="btn-danger" disabled={isDestroying} onClick={handleDestroy} type="button">
                {isDestroying ? <LoaderCircle className="spin-icon" size={17} strokeWidth={1.8} /> : <Trash2 size={17} strokeWidth={1.8} />}
                {isDestroying ? "Destroying..." : "Destroy and reset"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
