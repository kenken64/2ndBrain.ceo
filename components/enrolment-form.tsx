"use client";

import { Localized, LocalizedMessage } from "@/components/language-provider";

import { navigateToPage } from "@/lib/page-navigation";

import { FormEvent, useId, useState } from "react";
import { Bot, Sparkles, UserRound, UsersRound } from "lucide-react";
import { TelegramTokenInput } from "@/components/telegram-token-input";

type EnrolmentFormProps = {
  avatarGender: string;
  avatarName: string;
  errorMessage: string | null;
  next: string;
  ownerName: string;
};

type EnrolmentErrors = Partial<Record<"avatarGender" | "avatarName" | "ownerName" | "telegramBotToken" | "submit", string>>;

function validateEnrolment(formData: FormData) {
  const errors: EnrolmentErrors = {};
  const ownerName = String(formData.get("ownerName") ?? "").trim();
  const avatarName = String(formData.get("avatarName") ?? "").trim();
  const avatarGender = String(formData.get("avatarGender") ?? "").trim();
  const telegramBotToken = String(formData.get("telegramBotToken") ?? "").trim();

  if (!ownerName) {
    errors.ownerName = "Owner name is required.";
  } else if (ownerName.length > 80) {
    errors.ownerName = "Owner name must be 80 characters or fewer.";
  }

  if (!avatarName) {
    errors.avatarName = "AI Assistant name is required.";
  } else if (avatarName.length > 80) {
    errors.avatarName = "AI Assistant name must be 80 characters or fewer.";
  }

  if (avatarGender !== "female" && avatarGender !== "male") {
    errors.avatarGender = "Select the AI Assistant gender.";
  }

  if (!telegramBotToken) {
    errors.telegramBotToken = "Telegram bot token is required.";
  } else if (telegramBotToken.length > 256) {
    errors.telegramBotToken = "Telegram bot token is too long.";
  }

  return errors;
}

function hasErrors(errors: EnrolmentErrors) {
  return Object.values(errors).some(Boolean);
}

export function EnrolmentForm({
  avatarGender,
  avatarName,
  errorMessage,
  next,
  ownerName
}: EnrolmentFormProps) {
  const [errors, setErrors] = useState<EnrolmentErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const ownerErrorId = useId();
  const avatarErrorId = useId();
  const genderErrorId = useId();
  const tokenErrorId = useId();
  const submitErrorId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const nextErrors = validateEnrolment(formData);

    if (hasErrors(nextErrors)) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setIsSubmitting(true);

    try {
      const response = await fetch(form.action, {
        body: formData,
        credentials: "same-origin",
        method: "POST"
      });

      navigateToPage(response.url || `/onboarding?next=${encodeURIComponent(next)}&step=avatar`);
    } catch {
      setErrors({ submit: "Profile setup could not be saved. Check the server and try again." });
      setIsSubmitting(false);
    }
  }

  return (
    <form action="/api/onboarding" className="onboarding-form" method="post" noValidate onSubmit={handleSubmit}>
      <input name="step" type="hidden" value="enrolment" />
      <input name="next" type="hidden" value={next} />
      <div className="field-grid">
        <label className="field-stack">
          <span>
            <UserRound size={18} strokeWidth={1.8} />
            <Localized en="Owner name" zh="所有者姓名" />
          </span>
          <input
            aria-describedby={errors.ownerName ? ownerErrorId : undefined}
            aria-invalid={Boolean(errors.ownerName)}
            autoComplete="name"
            defaultValue={ownerName}
            maxLength={80}
            name="ownerName"
            placeholder="Kenneth"
            type="text"
          />
          {errors.ownerName ? (
            <span className="field-error" id={ownerErrorId}>
              <LocalizedMessage text={errors.ownerName} />
            </span>
          ) : null}
        </label>
        <label className="field-stack">
          <span>
            <Sparkles size={18} strokeWidth={1.8} />
            <Localized en="AI Assistant name" zh="AI 助手名称" />
          </span>
          <input
            aria-describedby={errors.avatarName ? avatarErrorId : undefined}
            aria-invalid={Boolean(errors.avatarName)}
            autoComplete="off"
            defaultValue={avatarName}
            maxLength={80}
            name="avatarName"
            placeholder="Ari"
            type="text"
          />
          {errors.avatarName ? (
            <span className="field-error" id={avatarErrorId}>
              <LocalizedMessage text={errors.avatarName} />
            </span>
          ) : null}
        </label>
      </div>
      <label className="field-stack">
        <span>
          <UsersRound size={18} strokeWidth={1.8} />
          <Localized en="Gender of the AI Assistant" zh="AI 助手性别" />
        </span>
        <select
          aria-describedby={errors.avatarGender ? genderErrorId : undefined}
          aria-invalid={Boolean(errors.avatarGender)}
          defaultValue={avatarGender}
          name="avatarGender"
        >
          <option value="" disabled>
            <Localized en="Select gender" zh="选择性别" />
          </option>
          <option value="female"><Localized en="Female" zh="女性" /></option>
          <option value="male"><Localized en="Male" zh="男性" /></option>
        </select>
        {errors.avatarGender ? (
          <span className="field-error" id={genderErrorId}>
            <LocalizedMessage text={errors.avatarGender} />
          </span>
        ) : null}
      </label>
      <label className="field-stack">
        <span>
          <Bot size={18} strokeWidth={1.8} />
          <Localized en="Telegram bot token" zh="Telegram 机器人令牌" />
        </span>
        <TelegramTokenInput
          ariaDescribedBy={errors.telegramBotToken ? tokenErrorId : undefined}
          isInvalid={Boolean(errors.telegramBotToken)}
        />
        {errors.telegramBotToken ? (
          <span className="field-error" id={tokenErrorId}>
            <LocalizedMessage text={errors.telegramBotToken} />
          </span>
        ) : null}
      </label>
      {errorMessage ? <p className="form-error"><LocalizedMessage text={errorMessage} /></p> : null}
      {errors.submit ? (
        <p className="form-error" id={submitErrorId}>
          <LocalizedMessage text={errors.submit} />
        </p>
      ) : null}
      <button className="btn-primary onboarding-submit" disabled={isSubmitting} type="submit">
        {isSubmitting ? <Localized en="Saving..." zh="正在保存..." /> : <Localized en="Continue" zh="继续" />} <span className="arrow">-&gt;</span>
      </button>
    </form>
  );
}
