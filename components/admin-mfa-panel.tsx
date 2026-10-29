"use client";

import { Localized, useLanguage, LocalizedMessage } from "@/components/language-provider";


import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

type TotpFactor = {
  created_at?: string;
  friendly_name?: string;
  id: string;
  status?: string;
};

type Enrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

type AdminMfaPanelProps = {
  nextPath: string;
  supabasePublishableKey: string;
  supabaseUrl: string;
};

type BusyAction = "enroll" | "verify";

type TotpWindow = {
  percentRemaining: number;
  secondsRemaining: number;
};

const TOTP_PERIOD_SECONDS = 30;

function getTotpWindow(now = Date.now()): TotpWindow {
  const periodMs = TOTP_PERIOD_SECONDS * 1000;
  const remainingMs = periodMs - (now % periodMs);

  return {
    percentRemaining: Math.max(0, Math.min(100, Math.round((remainingMs / periodMs) * 100))),
    secondsRemaining: Math.max(1, Math.ceil(remainingMs / 1000))
  };
}

function qrCodeImageSrc(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("data:image/")) {
    return trimmed;
  }

  if (trimmed.startsWith("<svg")) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trimmed)}`;
  }

  return trimmed;
}

function newFriendlyName() {
  return `AI CUBER admin ${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function factorLabel(factor: TotpFactor, index: number) {
  return factor.friendly_name?.trim() || `TOTP factor ${index + 1}`;
}

export function AdminMfaPanel({ nextPath, supabasePublishableKey, supabaseUrl }: AdminMfaPanelProps) {
  const _uiLanguage = useLanguage().language;
  const router = useRouter();
  const supabase = useMemo(
    () => createBrowserClient(supabaseUrl, supabasePublishableKey),
    [supabasePublishableKey, supabaseUrl]
  );
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [selectedFactorId, setSelectedFactorId] = useState("");
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [totpWindow, setTotpWindow] = useState<TotpWindow>({
    percentRemaining: 100,
    secondsRemaining: TOTP_PERIOD_SECONDS
  });
  const isBusy = busyAction !== null;

  useEffect(() => {
    let isMounted = true;

    supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (!isMounted) {
        return;
      }

      if (error) {
        setMessage(error.message);
        return;
      }

      const verifiedTotpFactors = (data?.totp ?? []).filter((factor) => factor.status === "verified");

      setFactors(verifiedTotpFactors);
      setSelectedFactorId((currentFactorId) =>
        currentFactorId || verifiedTotpFactors[0]?.id || ""
      );
    });

    return () => {
      isMounted = false;
    };
  }, [supabase]);

  useEffect(() => {
    function updateTotpWindow() {
      setTotpWindow(getTotpWindow());
    }

    updateTotpWindow();
    const intervalId = window.setInterval(updateTotpWindow, 250);

    return () => window.clearInterval(intervalId);
  }, []);

  async function startEnrollment() {
    setBusyAction("enroll");
    setMessage(null);

    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: newFriendlyName(),
        issuer: "AI CUBER"
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      setEnrollment({
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret
      });
      setSelectedFactorId(data.id);
      setCode("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "TOTP enrollment failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const factorId = enrollment?.factorId ?? selectedFactorId;

    if (!factorId) {
      setMessage("No verified TOTP factor is available for this account.");
      return;
    }

    if (!code.trim()) {
      setMessage("Enter the six-digit authenticator code.");
      return;
    }

    setBusyAction("verify");
    setMessage(null);

    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        code: code.trim(),
        factorId
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      const { data: aalData, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

      if (aalError) {
        setMessage(aalError.message);
        return;
      }

      if (aalData?.currentLevel !== "aal2") {
        setMessage("The TOTP code was accepted, but this browser session did not update to aal2. Sign out and sign in again, then verify the code once more.");
        return;
      }

      router.replace(nextPath);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "TOTP verification failed.");
    } finally {
      setBusyAction(null);
    }
  }

  const qrCodeSrc = enrollment ? qrCodeImageSrc(enrollment.qrCode) : null;
  const hasVerifiedFactor = factors.length > 0;

  return (
    <section className="auth-panel admin-mfa-panel">
      <h1>{hasVerifiedFactor && !enrollment ? <Localized en={"Verify admin TOTP"} zh={"验证管理员 TOTP"} /> : <Localized en={"Set up admin TOTP"} zh={"设置管理员 TOTP"} />}</h1>
      <p>
        {hasVerifiedFactor && !enrollment
          ? <Localized en={"Use your existing authenticator code to unlock admin controls for this session."} zh={"使用现有身份验证器验证码，解锁本次会话的管理员控制。"} />
          : <Localized en={"Create and verify a Supabase TOTP factor before using admin controls."} zh={"使用管理员控制前，请创建并验证 Supabase TOTP 验证方式。"} />}
      </p>

      {enrollment && qrCodeSrc ? (
        <div className="admin-mfa-panel__setup">
          <img alt={_uiLanguage === "zh" ? "TOTP 设置二维码" : "TOTP setup QR code"} src={qrCodeSrc} />
          <p>
            <Localized en={"Scan the QR code in an authenticator app, or enter this secret manually:"} zh={"使用身份验证器应用扫描二维码，或手动输入此密钥："} /><code>{enrollment.secret}</code>
          </p>
        </div>
      ) : null}

      {hasVerifiedFactor || enrollment ? (
        <form className="settings-dialog__form" onSubmit={verify}>
          {factors.length > 1 && !enrollment ? (
            <>
              <label htmlFor="totp-factor"><Localized en={"Authenticator"} zh={"身份验证器"} /></label>
              <select
                id="totp-factor"
                name="factorId"
                disabled={isBusy}
                onChange={(event) => setSelectedFactorId(event.target.value)}
                value={selectedFactorId}
              >
                {factors.map((factor, index) => (
                  <option key={factor.id} value={factor.id}>
                    {factorLabel(factor, index)}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <label htmlFor="totp-code"><Localized en={"Authenticator code"} zh={"身份验证器验证码"} /></label>
          <input
            autoComplete="one-time-code"
            disabled={isBusy}
            id="totp-code"
            inputMode="numeric"
            maxLength={8}
            name="code"
            onChange={(event) => setCode(event.target.value)}
            pattern="[0-9 ]*"
            placeholder={_uiLanguage === "zh" ? "6 位验证码" : "6-digit code"}
            value={code}
          />
          <div
            aria-label={_uiLanguage === "zh" ? "TOTP 验证码剩余时间" : "TOTP code time remaining"}
            aria-valuemax={TOTP_PERIOD_SECONDS}
            aria-valuemin={0}
            aria-valuenow={totpWindow.secondsRemaining}
            aria-valuetext={_uiLanguage === "zh" ? `剩余 ${totpWindow.secondsRemaining} 秒` : `${totpWindow.secondsRemaining} seconds remaining`}
            className="admin-mfa-panel__totp-progress"
            role="progressbar"
          >
            <div className="admin-mfa-panel__totp-meta">
              <span>{busyAction === "verify" ? <Localized en={"Verifying current code"} zh={"正在验证当前验证码"} /> : <Localized en={"Current code window"} zh={"当前验证码有效期"} />}</span>
              <strong>{_uiLanguage === "zh" ? `剩余 ${totpWindow.secondsRemaining} 秒` : `${totpWindow.secondsRemaining}s remaining`}</strong>
            </div>
            <div className="admin-mfa-panel__totp-track">
              <span style={{ width: `${totpWindow.percentRemaining}%` }} />
            </div>
          </div>
          <button className="btn-primary admin-mfa-panel__button" disabled={isBusy} type="submit">
            {busyAction === "verify" ? <Localized en={"Verifying..."} zh={"正在验证..."} /> : <Localized en={"Verify admin access"} zh={"验证管理员访问权限"} />}
          </button>
        </form>
      ) : null}

      <div className="admin-mfa-panel__actions">
        <a className="btn-ghost admin-mfa-panel__button" href="/dashboard">
          <Localized en={"Cancel"} zh={"取消"} /></a>
        {!enrollment && !hasVerifiedFactor ? (
          <button className="btn-primary admin-mfa-panel__button" disabled={isBusy} onClick={startEnrollment} type="button">
            {busyAction === "enroll" ? <Localized en={"Setting up..."} zh={"正在设置..."} /> : <Localized en={"Set up TOTP"} zh={"设置 TOTP"} />}
          </button>
        ) : enrollment && hasVerifiedFactor ? (
          <button
            className="btn-ghost admin-mfa-panel__button"
            disabled={isBusy}
            onClick={() => {
              setEnrollment(null);
              setSelectedFactorId(factors[0]?.id ?? "");
              setCode("");
              setMessage(null);
            }}
            type="button"
          >
            <Localized en={"Use existing TOTP"} zh={"使用现有 TOTP"} /></button>
        ) : null}
      </div>

      {message ? <p className="login-dialog__message" role="alert"><LocalizedMessage text={message} /></p> : null}
    </section>
  );
}
