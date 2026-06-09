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
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  async function startEnrollment() {
    setIsBusy(true);
    setMessage(null);

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: newFriendlyName(),
      issuer: "2ndBrain.ceo"
    });

    setIsBusy(false);

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

    setIsBusy(true);
    setMessage(null);

    const { error } = await supabase.auth.mfa.challengeAndVerify({
      code: code.trim(),
      factorId
    });

    setIsBusy(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (aalData?.currentLevel !== "aal2") {
      setMessage("The TOTP code was accepted, but this browser session did not update to aal2. Sign out and sign in again, then verify the code once more.");
      return;
    }

    router.replace(nextPath);
    router.refresh();
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
            id="totp-code"
            inputMode="numeric"
            maxLength={8}
            name="code"
            onChange={(event) => setCode(event.target.value)}
            pattern="[0-9 ]*"
            placeholder="6-digit code"
            value={code}
          />
          <button className="btn-primary admin-mfa-panel__button" disabled={isBusy} type="submit">
            Verify admin access
          </button>
        </form>
      ) : null}

      <div className="admin-mfa-panel__actions">
        <a className="btn-ghost admin-mfa-panel__button" href="/dashboard">
          Cancel
        </a>
        {!enrollment && !hasVerifiedFactor ? (
          <button className="btn-primary admin-mfa-panel__button" disabled={isBusy} onClick={startEnrollment} type="button">
            Set up TOTP
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
