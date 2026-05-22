"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { KeyRound } from "lucide-react";

type TelegramApprovalFormProps = {
  errorMessage: string | null;
  next: string;
  status?: string | null;
};

export function TelegramApprovalForm({ errorMessage, next, status }: TelegramApprovalFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [remoteStatus, setRemoteStatus] = useState(status ?? null);
  const [canRetry, setCanRetry] = useState(false);
  const codeErrorId = useId();
  const isRunning = remoteStatus === "running" && !canRetry;
  const isDisabled = isRunning || isSubmitting;

  useEffect(() => {
    setRemoteStatus(status ?? null);
  }, [status]);

  useEffect(() => {
    if (!isRunning && !isSubmitting) {
      return;
    }

    let cancelled = false;

    async function pollStatus() {
      try {
        const response = await fetch(`/api/openclaw/telegram-pair/status?next=${encodeURIComponent(next)}`, {
          credentials: "same-origin"
        });
        const data = (await response.json().catch(() => null)) as
          | {
              canRetry?: boolean;
              error?: string;
              message?: string;
              redirectTo?: string;
              status?: string;
            }
          | null;

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          throw new Error(data?.error ?? "Telegram approval status could not be checked.");
        }

        if (data?.redirectTo) {
          window.location.assign(data.redirectTo);
          return;
        }

        setRemoteStatus(data?.status ?? null);
        setCanRetry(Boolean(data?.canRetry));

        if (data?.canRetry) {
          setIsSubmitting(false);
          setSubmitError(data.message ?? "Telegram approval timed out. Submit the approval code again.");
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        setIsSubmitting(false);
        setCanRetry(true);
        setRemoteStatus("failed");
        setSubmitError(error instanceof Error ? error.message : "Telegram approval status could not be checked.");
      }
    }

    pollStatus();
    const interval = window.setInterval(pollStatus, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isRunning, isSubmitting, next]);

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
    setCanRetry(false);
    setRemoteStatus("running");

    try {
      const response = await fetch("/api/openclaw/telegram-pair", {
        body: formData,
        credentials: "same-origin",
        method: "POST"
      });

      if (response.redirected && response.url) {
        window.location.assign(response.url);
        return;
      }

      const data = (await response.json().catch(() => null)) as { error?: string; redirectTo?: string } | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Telegram approval failed. Check the code from Telegram and try again.");
      }

      if (data?.redirectTo) {
        window.location.assign(data.redirectTo);
      }
    } catch (error) {
      setCanRetry(true);
      setRemoteStatus("failed");
      setSubmitError(error instanceof Error ? error.message : "Telegram approval could not be started. Check the server and try again.");
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
        <span>Open your Telegram bot, copy the 8-character approval code, and submit it here before creating the Nth Brain.</span>
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
