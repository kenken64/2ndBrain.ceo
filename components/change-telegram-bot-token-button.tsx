"use client";

import { FormEvent, useId, useState } from "react";
import { Bot, Eye, EyeOff, LoaderCircle, Send, X } from "lucide-react";

type ChangeTelegramBotTokenButtonProps = {
  variant?: "sidebar" | "panel";
};

function validateTelegramBotToken(value: string) {
  if (!value) {
    return "Telegram bot token is required.";
  }

  if (value.length > 256) {
    return "Telegram bot token is too long.";
  }

  if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(value)) {
    return "Enter a valid Telegram bot token.";
  }

  return "";
}

export function ChangeTelegramBotTokenButton({ variant = "sidebar" }: ChangeTelegramBotTokenButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTokenVisible, setIsTokenVisible] = useState(false);
  const [error, setError] = useState("");
  const tokenErrorId = useId();
  const buttonClassName =
    variant === "panel" ? "settings-action-button settings-action-button--telegram" : "sidebar-item sidebar-item--telegram";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const token = String(formData.get("telegramBotToken") ?? "").trim();
    const validationError = validateTelegramBotToken(token);

    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const response = await fetch(form.action, {
        body: formData,
        credentials: "same-origin",
        method: "POST"
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Telegram bot token update failed");
      }

      window.location.assign(payload?.redirectTo ?? "/onboarding?next=%2Fdashboard&step=approval");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Telegram bot token update failed");
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button className={buttonClassName} onClick={() => setIsDialogOpen(true)} type="button">
        <Bot size={18} strokeWidth={1.7} />
        Change Telegram bot
      </button>
      {isDialogOpen ? (
        <div className="settings-dialog" role="presentation">
          <button
            aria-label="Close Telegram bot token dialog"
            className="settings-dialog__scrim"
            disabled={isSubmitting}
            onClick={() => setIsDialogOpen(false)}
            type="button"
          />
          <section aria-labelledby="telegram-token-dialog-title" aria-modal="true" className="settings-dialog__panel" role="dialog">
            <button
              aria-label="Close Telegram bot token dialog"
              className="settings-dialog__close"
              disabled={isSubmitting}
              onClick={() => setIsDialogOpen(false)}
              type="button"
            >
              <X size={18} strokeWidth={1.8} />
            </button>
            <div className="settings-dialog__icon" aria-hidden="true">
              <Bot size={28} strokeWidth={1.9} />
            </div>
            <p className="workspace-status-card__eyebrow">Telegram bot</p>
            <h2 id="telegram-token-dialog-title">Change Telegram bot token</h2>
            <p>
              This updates the token on your current OpenClaw instance and resets Telegram pairing. After it finishes, approve the new pairing code from the new bot.
            </p>
            <form action="/api/openclaw/telegram-token" className="settings-dialog__form" method="post" noValidate onSubmit={handleSubmit}>
              <input name="next" type="hidden" value="/dashboard" />
              <label className="field-stack">
                <span>
                  <Send size={18} strokeWidth={1.8} />
                  New Telegram bot token
                </span>
                <div className="secret-input">
                  <input
                    aria-describedby={error ? tokenErrorId : undefined}
                    aria-invalid={Boolean(error)}
                    autoComplete="off"
                    disabled={isSubmitting}
                    name="telegramBotToken"
                    placeholder="123456789:AA..."
                    type={isTokenVisible ? "text" : "password"}
                  />
                  <button
                    aria-label={isTokenVisible ? "Hide Telegram bot token" : "Show Telegram bot token"}
                    className="secret-input__toggle"
                    disabled={isSubmitting}
                    onClick={() => setIsTokenVisible((current) => !current)}
                    type="button"
                  >
                    {isTokenVisible ? <EyeOff size={18} strokeWidth={1.8} /> : <Eye size={18} strokeWidth={1.8} />}
                  </button>
                </div>
              </label>
              {error ? (
                <p className="form-error" id={tokenErrorId}>
                  {error}
                </p>
              ) : null}
              {isSubmitting ? (
                <div
                  aria-live="polite"
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={68}
                  className="submit-progress settings-dialog__progress"
                  role="progressbar"
                >
                  <div className="submit-progress__meta">
                    <strong>Updating Telegram bot</strong>
                    <span>Saving the new token, reconfiguring OpenClaw, and resetting Telegram pairing.</span>
                  </div>
                  <div className="submit-progress__track">
                    <span className="submit-progress__bar" />
                  </div>
                </div>
              ) : null}
              <div className="settings-dialog__actions">
                <button className="btn-ghost" disabled={isSubmitting} onClick={() => setIsDialogOpen(false)} type="button">
                  Cancel
                </button>
                <button className="btn-primary btn-primary--compact" disabled={isSubmitting} type="submit">
                  {isSubmitting ? <LoaderCircle className="spin-icon" size={17} strokeWidth={1.8} /> : <Bot size={17} strokeWidth={1.8} />}
                  {isSubmitting ? "Updating..." : "Update token"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
