"use client";

import { translateUiMessage } from "@/lib/ui-messages";
import { createContext, createElement, useContext, useEffect, useState, type ReactNode, type HTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

export type Language = "en" | "zh";
const LanguageContext = createContext<{ language: Language; setLanguage: (language: Language) => void }>({ language: "en", setLanguage: () => {} });

export function LanguageProvider({ initialLanguage, children }: { initialLanguage: Language; children: ReactNode }) {
  const [language, setCurrentLanguage] = useState(initialLanguage);
  useEffect(() => { document.documentElement.lang = language === "zh" ? "zh-CN" : "en"; }, [language]);
  function setLanguage(next: Language) {
    document.cookie = `aicuber_landing_locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setCurrentLanguage(next);
  }
  return <LanguageContext.Provider value={{ language, setLanguage }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() { return useContext(LanguageContext); }

export function Localized({ en, zh }: { en: ReactNode; zh: ReactNode }) {
  const { language } = useLanguage();
  return <>{language === "zh" ? zh : en}</>;
}

export function LanguageToggle({ className = "language-toggle" }: { className?: string }) {
  const { language, setLanguage } = useLanguage();
  const chinese = language === "zh";
  return <button className={className} type="button" onClick={() => setLanguage(chinese ? "en" : "zh")} aria-label={chinese ? "Switch to English" : "切换到中文"}>{chinese ? "English" : "中文"}</button>;
}

export function LocalizedMessage({ text }: { text: string }) {
  const { language } = useLanguage();
  return <>{translateUiMessage(text, language)}</>;
}

export function LocalizedInput({ placeholderEn, placeholderZh, ...props }: InputHTMLAttributes<HTMLInputElement> & { placeholderEn: string; placeholderZh: string }) {
  const { language } = useLanguage();
  return <input {...props} placeholder={language === "zh" ? placeholderZh : placeholderEn} />;
}

export function LocalizedTextarea({ placeholderEn, placeholderZh, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { placeholderEn: string; placeholderZh: string }) {
  const { language } = useLanguage();
  return <textarea {...props} placeholder={language === "zh" ? placeholderZh : placeholderEn} />;
}

export function LocalizedContainer({ as, labelEn, labelZh, children, ...props }: HTMLAttributes<HTMLElement> & { as: "ol" | "div" | "nav" | "section"; labelEn: string; labelZh: string; children: ReactNode }) {
  const { language } = useLanguage();
  return createElement(as, { ...props, "aria-label": language === "zh" ? labelZh : labelEn }, children);
}
