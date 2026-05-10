"use client";

import { useEffect, useId } from "react";
import { X } from "lucide-react";
import { BrandHeart } from "@/components/brand-heart";

type LoginDialogProps = {
  error?: string;
  isOpen?: boolean;
  next?: string;
  onClose?: () => void;
  supabaseConfigured?: boolean;
};

export function LoginDialog({
  error,
  isOpen = true,
  next = "/dashboard",
  onClose,
  supabaseConfigured = true
}: LoginDialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!isOpen || !onClose) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose?.();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="login-modal" role="presentation">
      {onClose ? (
        <button
          aria-label="Close login dialog"
          className="login-modal__scrim"
          onClick={onClose}
          type="button"
        />
      ) : (
        <a aria-label="Close login dialog" className="login-modal__scrim" href="/" />
      )}
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="login-dialog"
        role="dialog"
      >
        {onClose ? (
          <button
            aria-label="Close login dialog"
            className="login-dialog__close"
            onClick={onClose}
            type="button"
          >
            <X size={18} strokeWidth={1.8} />
          </button>
        ) : (
          <a aria-label="Close login dialog" className="login-dialog__close" href="/">
            <X size={18} strokeWidth={1.8} />
          </a>
        )}

        <div className="login-dialog__brand">
          <BrandHeart size={82} />
        </div>

        <div className="login-dialog__copy">
          <h1 id={titleId}>Log in to 2ndBrain</h1>
          <p id={descriptionId}>
            Continue to your workspace and keep building from where you left off.
          </p>
        </div>

        {error ? (
          <p className="login-dialog__message" role="alert">
            Authentication could not complete: {error}
          </p>
        ) : null}

        <div className="login-dialog__actions">
          {supabaseConfigured ? (
            <a className="login-provider" href={`/auth/login?next=${encodeURIComponent(next)}`}>
              <span aria-hidden="true" className="google-g">
                G
              </span>
              Continue with Google
            </a>
          ) : (
            <p className="login-dialog__message" role="alert">
              Supabase credentials are required before login can run.
            </p>
          )}
        </div>

        <p className="login-dialog__footnote">New accounts continue into workspace setup.</p>
      </section>
    </div>
  );
}
