"use client";

import { Localized, LocalizedMessage } from "@/components/language-provider";


import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, LoaderCircle, Trash2, X } from "lucide-react";

type ConfirmDialogProps = {
  /** Disables every control and swaps the confirm button for a spinner. */
  busy?: boolean;
  busyLabel?: string;
  closeLabel: string;
  confirmIcon?: ReactNode;
  confirmLabel: string;
  /** When set, the confirm button stays disabled until this exact word is typed. Use uppercase. */
  confirmWord?: string;
  description: ReactNode;
  error?: string | null;
  eyebrow: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
  warning?: ReactNode;
};

/**
 * Shared confirmation for destructive actions, styled by the `.destroy-dialog`
 * rules in app/globals.css. Remounts on open so typed confirmation and error
 * text never leak between openings.
 */
export function ConfirmDialog({ open, ...props }: ConfirmDialogProps) {
  if (!open) {
    return null;
  }

  return <ConfirmDialogPanel {...props} />;
}

function ConfirmDialogPanel({
  busy = false,
  busyLabel,
  closeLabel,
  confirmIcon,
  confirmLabel,
  confirmWord,
  description,
  error,
  eyebrow,
  onCancel,
  onConfirm,
  title,
  warning
}: Omit<ConfirmDialogProps, "open">) {
  const titleId = useId();
  const confirmFieldId = useId();
  const [confirmationText, setConfirmationText] = useState("");
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const isConfirmed = !confirmWord || confirmationText.trim() === confirmWord;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (!confirmWord) {
      confirmButtonRef.current?.focus();
    }
  }, [confirmWord]);

  return (
    <div className="destroy-dialog" role="presentation">
      <button
        aria-label={closeLabel}
        className="destroy-dialog__scrim"
        disabled={busy}
        onClick={onCancel}
        type="button"
      />
      <section aria-labelledby={titleId} aria-modal="true" className="destroy-dialog__panel" role="dialog">
        <button aria-label={closeLabel} className="destroy-dialog__close" disabled={busy} onClick={onCancel} type="button">
          <X size={18} strokeWidth={1.8} />
        </button>
        <div className="destroy-dialog__icon" aria-hidden="true">
          <AlertTriangle size={28} strokeWidth={1.9} />
        </div>
        <p className="workspace-status-card__eyebrow"><LocalizedMessage text={eyebrow} /></p>
        <h2 id={titleId}><LocalizedMessage text={title} /></h2>
        {typeof description === "string" ? <p><LocalizedMessage text={description} /></p> : description}
        {warning ? <div className="destroy-dialog__warning">{typeof warning === "string" ? <LocalizedMessage text={warning} /> : warning}</div> : null}
        {confirmWord ? (
          <label className="field-stack" htmlFor={confirmFieldId}>
            <span><Localized en={`Type ${confirmWord} to confirm`} zh={`输入 ${confirmWord} 以确认`} /></span>
            <input
              autoCapitalize="characters"
              autoComplete="off"
              autoFocus
              disabled={busy}
              id={confirmFieldId}
              onChange={(event) => setConfirmationText(event.target.value.toUpperCase())}
              placeholder={confirmWord}
              type="text"
              value={confirmationText}
            />
          </label>
        ) : null}
        {error ? <p className="form-error"><LocalizedMessage text={error} /></p> : null}
        <div className="destroy-dialog__actions">
          <button className="btn-ghost" disabled={busy} onClick={onCancel} type="button">
            <Localized en={"Cancel"} zh={"取消"} /></button>
          <button
            className="btn-danger"
            disabled={busy || !isConfirmed}
            onClick={onConfirm}
            ref={confirmButtonRef}
            type="button"
          >
            {busy ? (
              <LoaderCircle className="spin-icon" size={17} strokeWidth={1.8} />
            ) : (
              confirmIcon ?? <Trash2 size={17} strokeWidth={1.8} />
            )}
            <LocalizedMessage text={busy ? busyLabel ?? confirmLabel : confirmLabel} />
          </button>
        </div>
      </section>
    </div>
  );
}
