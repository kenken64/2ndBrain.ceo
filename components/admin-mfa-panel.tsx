"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

type TotpFactor = {
  friendly_name?: string;
  id: string;
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

export function AdminMfaPanel({ nextPath, supabasePublishableKey, supabaseUrl }: AdminMfaPanelProps) {
  const router = useRouter();
  const supabase = useMemo(
    () => createBrowserClient(supabaseUrl, supabasePublishableKey),
    [supabasePublishableKey, supabaseUrl]
  );
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [factors, setFactors] = useState<TotpFactor[]>([]);
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

      setFactors(data?.totp ?? []);
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
      friendlyName: "2ndBrain admin",
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
  }

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const factorId = enrollment?.factorId ?? factors[0]?.id;

    if (!factorId) {
      setMessage("Set up a TOTP factor before verifying.");
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

    router.replace(nextPath);
    router.refresh();
  }

  const qrCodeSrc = enrollment
    ? `data:image/svg+xml;utf-8,${encodeURIComponent(enrollment.qrCode)}`
    : null;

  return (
    <section className="auth-panel admin-mfa-panel">
      <h1>Admin TOTP required</h1>
      <p>Verify a Supabase TOTP factor before using admin controls.</p>

      {factors.length === 0 && !enrollment ? (
        <button className="btn-primary" disabled={isBusy} onClick={startEnrollment} type="button">
          Set up TOTP
        </button>
      ) : null}

      {enrollment && qrCodeSrc ? (
        <div className="admin-mfa-panel__setup">
          <img alt="TOTP setup QR code" src={qrCodeSrc} />
          <p>
            Scan the QR code in an authenticator app, or enter this secret manually:
            <code>{enrollment.secret}</code>
          </p>
        </div>
      ) : null}

      {factors.length > 0 || enrollment ? (
        <form className="settings-dialog__form" onSubmit={verify}>
          <label htmlFor="totp-code">Authenticator code</label>
          <input
            autoComplete="one-time-code"
            id="totp-code"
            inputMode="numeric"
            maxLength={8}
            name="code"
            onChange={(event) => setCode(event.target.value)}
            pattern="[0-9 ]*"
            placeholder="123456"
            value={code}
          />
          <button className="btn-primary" disabled={isBusy} type="submit">
            Verify admin access
          </button>
        </form>
      ) : null}

      {message ? <p className="login-dialog__message" role="alert">{message}</p> : null}
    </section>
  );
}
