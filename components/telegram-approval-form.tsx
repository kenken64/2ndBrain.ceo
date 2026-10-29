"use client";

import { Localized, useLanguage, LocalizedMessage } from "@/components/language-provider";


import { navigateToPage } from "@/lib/page-navigation";

import { FormEvent, useEffect, useId, useState } from "react";
import { KeyRound } from "lucide-react";

type TelegramApprovalFormProps = {
  errorMessage: string | null;
  next: string;
  status?: string | null;
};

export function TelegramApprovalForm({ errorMessage, next, status }: TelegramApprovalFormProps) {
  const _uiLanguage = useLanguage().language;
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
          navigateToPage(data.redirectTo);
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
        navigateToPage(response.url);
        return;
      }

      const data = (await response.json().catch(() => null)) as { error?: string; redirectTo?: string } | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Telegram approval failed. Check the code from Telegram and try again.");
      }

      if (data?.redirectTo) {
        navigateToPage(data.redirectTo);
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
          <Localized en={"Telegram approval code"} zh={"Telegram 批准码"} /></span>
        <input
          aria-describedby={submitError ? codeErrorId : undefined}
          aria-invalid={Boolean(submitError)}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          inputMode="text"
          maxLength={8}
          name="telegramPairCode"
          placeholder={_uiLanguage === "zh" ? "8 位验证码" : "8-character code"}
          type="text"
        />
      </label>
      <div className="provision-summary">
        <strong><Localized en={"Telegram approval required"} zh={"需要 Telegram 批准"} /></strong>
        <span>
          <Localized en="Open your Telegram bot and send it any message, like “hi” (or tap Start) — the bot cannot message you first. It replies with the 8-character approval code; enter it here before creating the Nth Brain." zh="打开 Telegram 机器人并发送任意消息，例如“hi”（或点击开始）；机器人无法主动向您发送消息。机器人会回复 8 位批准码；创建 Nth Brain 前请在此输入。" />
        </span>
      </div>
      {errorMessage ? <p className="form-error"><LocalizedMessage text={errorMessage} /></p> : null}
      {submitError ? (
        <p className="form-error" id={codeErrorId}>
          <LocalizedMessage text={submitError} />
        </p>
      ) : null}
      {isRunning ? <p className="form-success"><Localized en={"Approving Telegram pairing."} zh={"正在批准 Telegram 配对。"} /></p> : null}
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
            <strong><Localized en={"Approving Telegram"} zh={"正在批准 Telegram"} /></strong>
            <span><Localized en={"Pairing the bot and completing your dashboard handoff."} zh={"正在配对机器人并完成工作台交接。"} /></span>
          </div>
          <div className="submit-progress__track">
            <span className="submit-progress__bar" />
          </div>
        </div>
      ) : null}
      <button className="btn-primary onboarding-submit" disabled={isDisabled} type="submit">
        {isSubmitting ? <Localized en={"Approving..."} zh={"正在批准..."} /> : <Localized en={"Approve Telegram"} zh={"批准 Telegram"} />} <span className="arrow">-&gt;</span>
      </button>
    </form>
  );
}
