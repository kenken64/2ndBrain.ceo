"use client";

import {Localized, useLanguage } from "@/components/language-provider";


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
  const _uiLanguage = useLanguage().language;
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
        {isDeleting ? <Localized en={"Deleting..."} zh={"正在删除..."} /> : <Localized en={"Delete"} zh={"删除"} />}
      </button>
      <ConfirmDialog
        busy={isDeleting}
        busyLabel="Deleting..."
        closeLabel="Close delete Nth Brain dialog"
        confirmLabel="Delete Nth Brain"
        confirmWord="DELETE"
        description={
          <p>
            <Localized en={<>This deletes <strong>{title}</strong> from Supabase and removes its AI Agent workspace directory.</>} zh={<>这将从 Supabase 删除 <strong>{title}</strong> 并移除其 AI Agent 工作空间目录。</>} />
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
        title={_uiLanguage === "zh" ? "删除此 Nth Brain？" : "Delete this Nth Brain?"}
        warning={<Localized en={`AI Agent folder: ${projectSlug ?? "No folder attached"}. This action cannot be undone.`} zh={`AI Agent 文件夹：${projectSlug ?? "无关联文件夹"}。此操作无法撤销。`} />}
      />
    </>
  );
}
