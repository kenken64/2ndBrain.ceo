"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type TelegramTokenInputProps = {
  ariaDescribedBy?: string;
  isInvalid?: boolean;
};

export function TelegramTokenInput({ ariaDescribedBy, isInvalid = false }: TelegramTokenInputProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="secret-input">
      <input
        aria-describedby={ariaDescribedBy}
        aria-invalid={isInvalid}
        autoComplete="off"
        name="telegramBotToken"
        placeholder="123456789:AA..."
        type={isVisible ? "text" : "password"}
      />
      <button
        aria-label={isVisible ? "Hide Telegram bot token" : "Show Telegram bot token"}
        className="secret-input__toggle"
        onClick={() => setIsVisible((current) => !current)}
        type="button"
      >
        {isVisible ? <EyeOff size={18} strokeWidth={1.8} /> : <Eye size={18} strokeWidth={1.8} />}
      </button>
    </div>
  );
}
