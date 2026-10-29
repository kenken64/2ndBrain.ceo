"use client";

import { Localized, useLanguage, LocalizedMessage } from "@/components/language-provider";


import { navigateToPage } from "@/lib/page-navigation";

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
  const _uiLanguage = useLanguage().language;
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

      navigateToPage(payload?.redirectTo ?? "/onboarding?next=%2Fdashboard&step=approval");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Telegram bot token update failed");
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button className={buttonClassName} onClick={() => setIsDialogOpen(true)} type="button">
        <Bot size={18} strokeWidth={1.7} />
        <Localized en={"Change Telegram bot"} zh={"更换 Telegram 机器人"} /></button>
      {isDialogOpen ? (
        <div className="settings-dialog" role="presentation">
          <button
            aria-label={_uiLanguage === "zh" ? "关闭 Telegram 机器人令牌对话框" : "Close Telegram bot token dialog"}
            className="settings-dialog__scrim"
            disabled={isSubmitting}
            onClick={() => setIsDialogOpen(false)}
            type="button"
          />
          <section aria-labelledby="telegram-token-dialog-title" aria-modal="true" className="settings-dialog__panel" role="dialog">
            <button
              aria-label={_uiLanguage === "zh" ? "关闭 Telegram 机器人令牌对话框" : "Close Telegram bot token dialog"}
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
            <p className="workspace-status-card__eyebrow"><Localized en={"Telegram bot"} zh={"Telegram 机器人"} /></p>
            <h2 id="telegram-token-dialog-title"><Localized en={"Change Telegram bot token"} zh={"更换 Telegram 机器人令牌"} /></h2>
            <p>
              <Localized en={"This updates the token on your current AI Agent instance and resets Telegram pairing. After it finishes, approve the new pairing code from the new bot."} zh={"这会更新当前 AI Agent 实例上的令牌并重置 Telegram 配对。完成后，请批准新机器人提供的配对码。"} /></p>
            <form action="/api/openclaw/telegram-token" className="settings-dialog__form" method="post" noValidate onSubmit={handleSubmit}>
              <input name="next" type="hidden" value="/dashboard" />
              <label className="field-stack">
                <span>
                  <Send size={18} strokeWidth={1.8} />
                  <Localized en={"New Telegram bot token"} zh={"新的 Telegram 机器人令牌"} /></span>
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
                    aria-label={_uiLanguage === "zh" ? (isTokenVisible ? "隐藏 Telegram 机器人令牌" : "显示 Telegram 机器人令牌") : (isTokenVisible ? "Hide Telegram bot token" : "Show Telegram bot token")}
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
                  <LocalizedMessage text={error} />
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
                    <strong><Localized en={"Updating Telegram bot"} zh={"正在更新 Telegram 机器人"} /></strong>
                    <span><Localized en={"Saving the new token, reconfiguring AI Agent, and resetting Telegram pairing."} zh={"正在保存新令牌、重新配置 AI Agent 并重置 Telegram 配对。"} /></span>
                  </div>
                  <div className="submit-progress__track">
                    <span className="submit-progress__bar" />
                  </div>
                </div>
              ) : null}
              <div className="settings-dialog__actions">
                <button className="btn-ghost" disabled={isSubmitting} onClick={() => setIsDialogOpen(false)} type="button">
                  <Localized en={"Cancel"} zh={"取消"} /></button>
                <button className="btn-primary btn-primary--compact" disabled={isSubmitting} type="submit">
                  {isSubmitting ? <LoaderCircle className="spin-icon" size={17} strokeWidth={1.8} /> : <Bot size={17} strokeWidth={1.8} />}
                  {isSubmitting ? <Localized en={"Updating..."} zh={"正在更新..."} /> : <Localized en={"Update token"} zh={"更新令牌"} />}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
