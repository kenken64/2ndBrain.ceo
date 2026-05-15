"use client";

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

      window.location.assign(response.url || `/onboarding?next=${encodeURIComponent(next)}&step=avatar`);
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
            Owner name
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
              {errors.ownerName}
            </span>
          ) : null}
        </label>
        <label className="field-stack">
          <span>
            <Sparkles size={18} strokeWidth={1.8} />
            AI Assistant name
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
              {errors.avatarName}
            </span>
          ) : null}
        </label>
      </div>
      <label className="field-stack">
        <span>
          <UsersRound size={18} strokeWidth={1.8} />
          Gender of the AI Assistant
        </span>
        <select
          aria-describedby={errors.avatarGender ? genderErrorId : undefined}
          aria-invalid={Boolean(errors.avatarGender)}
          defaultValue={avatarGender}
          name="avatarGender"
        >
          <option value="" disabled>
            Select gender
          </option>
          <option value="female">Female</option>
          <option value="male">Male</option>
        </select>
        {errors.avatarGender ? (
          <span className="field-error" id={genderErrorId}>
            {errors.avatarGender}
          </span>
        ) : null}
      </label>
      <label className="field-stack">
        <span>
          <Bot size={18} strokeWidth={1.8} />
          Telegram bot token
        </span>
        <TelegramTokenInput
          ariaDescribedBy={errors.telegramBotToken ? tokenErrorId : undefined}
          isInvalid={Boolean(errors.telegramBotToken)}
        />
        {errors.telegramBotToken ? (
          <span className="field-error" id={tokenErrorId}>
            {errors.telegramBotToken}
          </span>
        ) : null}
      </label>
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
      {errors.submit ? (
        <p className="form-error" id={submitErrorId}>
          {errors.submit}
        </p>
      ) : null}
      <button className="btn-primary onboarding-submit" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Saving..." : "Continue"} <span className="arrow">-&gt;</span>
      </button>
    </form>
  );
}
