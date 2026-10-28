"use client";

import { useEffect, useId } from "react";
import { X } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

type LoginDialogProps = {
  error?: string;
  isOpen?: boolean;
  next?: string;
  onClose?: () => void;
  supabaseConfigured?: boolean;
  locale?: "en" | "zh";
};

export function LoginDialog({
  error,
  isOpen = true,
  next = "/dashboard/chat",
  onClose,
  supabaseConfigured = true,
  locale = "en"
}: LoginDialogProps) {
  const chinese = locale === "zh";
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
          aria-label={chinese ? "关闭登录窗口" : "Close login dialog"}
          className="login-modal__scrim"
          onClick={onClose}
          type="button"
        />
      ) : (
        <a aria-label={chinese ? "关闭登录窗口" : "Close login dialog"} className="login-modal__scrim" href="/" />
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
            aria-label={chinese ? "关闭登录窗口" : "Close login dialog"}
            className="login-dialog__close"
            onClick={onClose}
            type="button"
          >
            <X size={18} strokeWidth={1.8} />
          </button>
        ) : (
          <a aria-label={chinese ? "关闭登录窗口" : "Close login dialog"} className="login-dialog__close" href="/">
            <X size={18} strokeWidth={1.8} />
          </a>
        )}

        <div className="login-dialog__brand">
          <BrandLogo size={82} />
        </div>

        <div className="login-dialog__copy">
          <h1 id={titleId}>{chinese ? "登录 AI CUBER" : "Log in to AI CUBER"}</h1>
          <p id={descriptionId}>
            {chinese ? "进入您的工作空间，继续之前的工作。" : "Continue to your workspace and keep building from where you left off."}
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
              {chinese ? "使用 Google 登录" : "Continue with Google"}
            </a>
          ) : (
            <p className="login-dialog__message" role="alert">
              {chinese ? "登录服务尚未配置，请联系管理员。" : "Supabase credentials are required before login can run."}
            </p>
          )}
        </div>

        <p className="login-dialog__footnote">{chinese ? "新用户登录后将进入工作空间设置。" : "New accounts continue into workspace setup."}</p>
      </section>
    </div>
  );
}
