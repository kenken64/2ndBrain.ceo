"use client";

import { LanguageToggle, useLanguage } from "@/components/language-provider";
import { translateUiMessage } from "@/lib/ui-messages";
import { navigateToPage } from "@/lib/page-navigation";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Mail, X } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

type LoginDialogProps = {
  error?: string;
  isOpen?: boolean;
  next?: string;
  onClose?: () => void;
  supabaseConfigured?: boolean;
  wechatEnabled?: boolean;
  locale?: "en" | "zh";
};

export function LoginDialog({
  error,
  isOpen = true,
  next = "/dashboard/chat",
  onClose,
  supabaseConfigured = true,
  wechatEnabled = false,
  locale
}: LoginDialogProps) {
  const language = useLanguage().language;
  const chinese = (locale ?? language) === "zh";
  const titleId = useId();
  const descriptionId = useId();
  const [emailMode, setEmailMode] = useState<"closed" | "login" | "signup" | "recover">("closed");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  function changeEmailMode(mode: "closed" | "login" | "signup" | "recover") {
    setEmailMode(mode); setEmailError(""); setEmailMessage(""); setPassword("");
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (emailMode === "closed" || emailBusy) return;
    setEmailBusy(true); setEmailError(""); setEmailMessage("");
    try {
      const response = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: emailMode, email, password, next }) });
      const data = await response.json() as { error?: string; message?: string; redirectTo?: string };
      if (!response.ok) throw new Error(data.error || "Unable to complete the request.");
      setPassword("");
      if (data.redirectTo) navigateToPage(data.redirectTo);
      else setEmailMessage(data.message || "Check your email.");
    } catch (reason) { setEmailError(reason instanceof Error ? reason.message : "Unable to complete the request."); }
    finally { setEmailBusy(false); }
  }

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

        {!onClose ? <LanguageToggle /> : null}
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
            {chinese ? "身份验证未完成：" : "Authentication could not complete: "}{translateUiMessage(error, chinese ? "zh" : "en")}
          </p>
        ) : null}

        <div className="login-dialog__actions">
          {supabaseConfigured ? <>
            <a className="login-provider" href={`/auth/login?next=${encodeURIComponent(next)}`}>
              <span aria-hidden="true" className="google-g">
                G
              </span>
              {chinese ? "使用 Google 登录" : "Continue with Google"}
            </a>
            {wechatEnabled ? <a className="login-provider login-provider--wechat" href={`/auth/login?provider=wechat&next=${encodeURIComponent(next)}`}>
              {/* WeChat mark from Simple Icons: https://simpleicons.org/ */}
              <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="#07C160">
                <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z" />
              </svg>
              {chinese ? "使用微信登录" : "Continue with WeChat"}
            </a> : null}
            {emailMode === "closed" ? <button className="login-provider login-provider--email" type="button" onClick={() => changeEmailMode("login")}><Mail size={19} aria-hidden="true" />{chinese ? "使用邮箱登录" : "Continue with email"}</button> : <form className="login-email" onSubmit={submitEmail}>
              <div className="login-email__heading"><strong>{emailMode === "signup" ? (chinese ? "创建账户" : "Create your account") : emailMode === "recover" ? (chinese ? "重置密码" : "Reset your password") : (chinese ? "使用邮箱登录" : "Sign in with email")}</strong><button type="button" onClick={() => changeEmailMode("closed")} aria-label={chinese ? "关闭邮箱登录" : "Close email sign-in"}><X size={16} /></button></div>
              <label htmlFor={`${titleId}-email`}>{chinese ? "邮箱" : "Email"}</label>
              <input id={`${titleId}-email`} type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={emailBusy} />
              {emailMode !== "recover" ? <><label htmlFor={`${titleId}-password`}>{chinese ? "密码" : "Password"}</label><input id={`${titleId}-password`} type="password" autoComplete={emailMode === "signup" ? "new-password" : "current-password"} required minLength={emailMode === "signup" ? 8 : undefined} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={emailBusy} />{emailMode === "signup" ? <small>{chinese ? "至少 8 个字符。" : "At least 8 characters."}</small> : null}</> : null}
              {emailError ? <p className="login-email__error" role="alert">{translateUiMessage(emailError, chinese ? "zh" : "en")}</p> : null}
              {emailMessage ? <p className="login-email__message" role="status">{translateUiMessage(emailMessage, chinese ? "zh" : "en")}</p> : null}
              <button className="login-email__submit" type="submit" disabled={emailBusy}>{emailBusy ? (chinese ? "请稍候…" : "Please wait…") : emailMode === "signup" ? (chinese ? "创建账户" : "Create account") : emailMode === "recover" ? (chinese ? "发送重置链接" : "Send reset link") : (chinese ? "登录" : "Sign in")}</button>
              <div className="login-email__links">{emailMode === "login" ? <><button type="button" onClick={() => changeEmailMode("signup")}>{chinese ? "创建账户" : "Create account"}</button><button type="button" onClick={() => changeEmailMode("recover")}>{chinese ? "忘记密码？" : "Forgot password?"}</button></> : <button type="button" onClick={() => changeEmailMode("login")}>{chinese ? "返回登录" : "Back to sign in"}</button>}</div>
            </form>}
          </> : (
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
