"use client";

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
  return `2ndBrain admin ${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function factorLabel(factor: TotpFactor, index: number) {
  return factor.friendly_name?.trim() || `TOTP factor ${index + 1}`;
}

export function AdminMfaPanel({ nextPath, supabasePublishableKey, supabaseUrl }: AdminMfaPanelProps) {
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
        issuer: "2ndBrain.ceo"
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
      <h1>{hasVerifiedFactor && !enrollment ? "Verify admin TOTP" : "Set up admin TOTP"}</h1>
      <p>
        {hasVerifiedFactor && !enrollment
          ? "Use your existing authenticator code to unlock admin controls for this session."
          : "Create and verify a Supabase TOTP factor before using admin controls."}
      </p>

      {enrollment && qrCodeSrc ? (
        <div className="admin-mfa-panel__setup">
          <img alt="TOTP setup QR code" src={qrCodeSrc} />
          <p>
            Scan the QR code in an authenticator app, or enter this secret manually:
            <code>{enrollment.secret}</code>
          </p>
        </div>
      ) : null}

      {hasVerifiedFactor || enrollment ? (
        <form className="settings-dialog__form" onSubmit={verify}>
          {factors.length > 1 && !enrollment ? (
            <>
              <label htmlFor="totp-factor">Authenticator</label>
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
          <label htmlFor="totp-code">Authenticator code</label>
          <input
            autoComplete="one-time-code"
            disabled={isBusy}
            id="totp-code"
            inputMode="numeric"
            maxLength={8}
            name="code"
            onChange={(event) => setCode(event.target.value)}
            pattern="[0-9 ]*"
            placeholder="6-digit code"
            value={code}
          />
          <div
            aria-label="TOTP code time remaining"
            aria-valuemax={TOTP_PERIOD_SECONDS}
            aria-valuemin={0}
            aria-valuenow={totpWindow.secondsRemaining}
            aria-valuetext={`${totpWindow.secondsRemaining} seconds remaining`}
            className="admin-mfa-panel__totp-progress"
            role="progressbar"
          >
            <div className="admin-mfa-panel__totp-meta">
              <span>{busyAction === "verify" ? "Verifying current code" : "Current code window"}</span>
              <strong>{totpWindow.secondsRemaining}s remaining</strong>
            </div>
            <div className="admin-mfa-panel__totp-track">
              <span style={{ width: `${totpWindow.percentRemaining}%` }} />
            </div>
          </div>
          <button className="btn-primary admin-mfa-panel__button" disabled={isBusy} type="submit">
            {busyAction === "verify" ? "Verifying..." : "Verify admin access"}
          </button>
        </form>
      ) : null}

      <div className="admin-mfa-panel__actions">
        <a className="btn-ghost admin-mfa-panel__button" href="/dashboard">
          Cancel
        </a>
        {!enrollment && !hasVerifiedFactor ? (
          <button className="btn-primary admin-mfa-panel__button" disabled={isBusy} onClick={startEnrollment} type="button">
            {busyAction === "enroll" ? "Setting up..." : "Set up TOTP"}
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
            Use existing TOTP
          </button>
        ) : null}
      </div>

      {message ? <p className="login-dialog__message" role="alert">{message}</p> : null}
    </section>
  );
}
