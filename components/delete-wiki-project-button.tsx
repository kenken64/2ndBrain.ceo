"use client";

import { useState } from "react";
import { AlertTriangle, LoaderCircle, Trash2, X } from "lucide-react";

type DeleteWikiProjectButtonProps = {
  disabled?: boolean;
  projectId: string;
  projectSlug: string | null;
  title: string;
};

export function DeleteWikiProjectButton({
  disabled = false,
  projectId,
  projectSlug,
  title
}: DeleteWikiProjectButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [error, setError] = useState("");
  const isConfirmed = confirmationText.trim() === "DELETE";

  async function handleDelete() {
    if (isDeleting || !isConfirmed) {
      return;
    }

    setIsDeleting(true);
    setError("");

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        credentials: "same-origin",
        method: "DELETE"
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Nth Brain deletion failed");
      }

      window.location.reload();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Nth Brain deletion failed");
      setIsDeleting(false);
    }
  }

  return (
    <>
      <button
        className="btn-danger btn-danger--compact"
        disabled={disabled || isDeleting}
        onClick={() => setIsDialogOpen(true)}
        type="button"
      >
        {isDeleting ? <LoaderCircle className="spin-icon" size={15} strokeWidth={1.8} /> : <Trash2 size={15} strokeWidth={1.8} />}
        {isDeleting ? "Deleting..." : "Delete"}
      </button>
      {isDialogOpen ? (
        <div className="destroy-dialog" role="presentation">
          <button
            aria-label="Close delete Nth Brain dialog"
            className="destroy-dialog__scrim"
            disabled={isDeleting}
            onClick={() => {
              setIsDialogOpen(false);
              setConfirmationText("");
              setError("");
            }}
            type="button"
          />
          <section aria-labelledby={`delete-wiki-${projectId}`} aria-modal="true" className="destroy-dialog__panel" role="dialog">
            <button
              aria-label="Close delete Nth Brain dialog"
              className="destroy-dialog__close"
              disabled={isDeleting}
              onClick={() => {
                setIsDialogOpen(false);
                setConfirmationText("");
                setError("");
              }}
              type="button"
            >
              <X size={18} strokeWidth={1.8} />
            </button>
            <div className="destroy-dialog__icon" aria-hidden="true">
              <AlertTriangle size={28} strokeWidth={1.9} />
            </div>
            <p className="workspace-status-card__eyebrow">Delete Nth Brain</p>
            <h2 id={`delete-wiki-${projectId}`}>Delete this Nth Brain?</h2>
            <p>
              This deletes <strong>{title}</strong> from Supabase and removes its OpenClaw workspace directory.
            </p>
            <div className="destroy-dialog__warning">
              OpenClaw folder: {projectSlug ?? "No folder attached"}. This action cannot be undone.
            </div>
            <label className="field-stack">
              <span>Type DELETE to confirm</span>
              <input
                autoCapitalize="characters"
                autoComplete="off"
                disabled={isDeleting}
                onChange={(event) => setConfirmationText(event.target.value.toUpperCase())}
                placeholder="DELETE"
                type="text"
                value={confirmationText}
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="destroy-dialog__actions">
              <button
                className="btn-ghost"
                disabled={isDeleting}
                onClick={() => {
                  setIsDialogOpen(false);
                  setConfirmationText("");
                  setError("");
                }}
                type="button"
              >
                Cancel
              </button>
              <button className="btn-danger" disabled={isDeleting || !isConfirmed} onClick={handleDelete} type="button">
                {isDeleting ? <LoaderCircle className="spin-icon" size={17} strokeWidth={1.8} /> : <Trash2 size={17} strokeWidth={1.8} />}
                {isDeleting ? "Deleting..." : "Delete Nth Brain"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
