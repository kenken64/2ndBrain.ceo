"use client";

import { FormEvent, useId, useState } from "react";
import { KeyRound } from "lucide-react";

type TelegramApprovalFormProps = {
  errorMessage: string | null;
  next: string;
  status?: string | null;
};

export function TelegramApprovalForm({ errorMessage, next, status }: TelegramApprovalFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const codeErrorId = useId();
  const isRunning = status === "running";
  const isDisabled = isRunning || isSubmitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isDisabled) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const code = String(formData.get("telegramPairCode") ?? "").trim();

    if (!/^[A-Za-z0-9]{8}$/.test(code)) {
      setSubmitError("Enter the 8-character approval code from Telegram.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    try {
      const response = await fetch("/api/openclaw/telegram-pair", {
        body: formData,
        credentials: "same-origin",
        method: "POST"
      });

      window.location.assign(response.url || `/onboarding?next=${encodeURIComponent(next)}&step=approval`);
    } catch {
      setSubmitError("Telegram approval could not be started. Check the server and try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <form className="onboarding-form" method="post" noValidate onSubmit={handleSubmit}>
      <input name="next" type="hidden" value={next} />
      <label className="field-stack">
        <span>
          <KeyRound size={18} strokeWidth={1.8} />
          Telegram approval code
        </span>
        <input
          aria-describedby={submitError ? codeErrorId : undefined}
          aria-invalid={Boolean(submitError)}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          inputMode="text"
          maxLength={8}
          name="telegramPairCode"
          placeholder="8-character code"
          type="text"
        />
      </label>
      <div className="provision-summary">
        <strong>Telegram approval required</strong>
        <span>Open your Telegram bot, copy the 8-character approval code, and submit it here before creating the Second Brain.</span>
      </div>
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
      {submitError ? (
        <p className="form-error" id={codeErrorId}>
          {submitError}
        </p>
      ) : null}
      {isRunning ? <p className="form-success">Approving Telegram pairing.</p> : null}
      {isSubmitting ? (
        <div
          aria-live="polite"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={72}
          className="submit-progress"
          role="progressbar"
        >
          <div className="submit-progress__meta">
            <strong>Approving Telegram</strong>
            <span>Pairing the bot and completing your dashboard handoff.</span>
          </div>
          <div className="submit-progress__track">
            <span className="submit-progress__bar" />
          </div>
        </div>
      ) : null}
      <button className="btn-primary onboarding-submit" disabled={isDisabled} type="submit">
        {isSubmitting ? "Approving..." : "Approve Telegram"} <span className="arrow">-&gt;</span>
      </button>
    </form>
  );
}
