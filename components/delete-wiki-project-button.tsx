"use client";

import { useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";

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
  const [error, setError] = useState("");

  async function handleDelete() {
    if (isDeleting) {
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
      <ConfirmDialog
        busy={isDeleting}
        busyLabel="Deleting..."
        closeLabel="Close delete Nth Brain dialog"
        confirmLabel="Delete Nth Brain"
        confirmWord="DELETE"
        description={
          <p>
            This deletes <strong>{title}</strong> from Supabase and removes its OpenClaw workspace directory.
          </p>
        }
        error={error}
        eyebrow="Delete Nth Brain"
        onCancel={() => {
          setIsDialogOpen(false);
          setError("");
        }}
        onConfirm={() => void handleDelete()}
        open={isDialogOpen}
        title="Delete this Nth Brain?"
        warning={<>OpenClaw folder: {projectSlug ?? "No folder attached"}. This action cannot be undone.</>}
      />
    </>
  );
}
