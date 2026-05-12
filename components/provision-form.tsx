"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type ProvisionFormProps = {
  errorMessage: string | null;
  next: string;
  status?: string | null;
};

export function ProvisionForm({ errorMessage, next, status }: ProvisionFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const isRunning = status === "running";
  const isDisabled = isRunning || isSubmitting;

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const interval = window.setInterval(() => {
      router.refresh();
    }, 10_000);

    return () => window.clearInterval(interval);
  }, [isRunning, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isDisabled) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    try {
      const response = await fetch("/api/openclaw/provision", {
        body: new FormData(event.currentTarget),
        credentials: "same-origin",
        method: "POST"
      });

      window.location.assign(response.url || `/onboarding?next=${encodeURIComponent(next)}&step=provision`);
    } catch {
      setSubmitError("Provisioning request could not be started. Check the server and try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <form className="onboarding-form" method="post" noValidate onSubmit={handleSubmit}>
      <input name="next" type="hidden" value={next} />
      <div className="provision-summary">
        <strong>Fast AWS Lightsail snapshot restore</strong>
        <span>Runs the single clawmacdo ls-restore-fast command with Telegram, identity, and Remotion environment settings.</span>
      </div>
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
      {submitError ? <p className="form-error">{submitError}</p> : null}
      {isRunning ? (
        <p className="form-success">
          Provisioning is running. This page will refresh automatically and move to approval when the instance is ready.
        </p>
      ) : null}
      {isSubmitting || isRunning ? (
        <div aria-live="polite" className="provision-pending">
          <span>Fast provisioning OpenClaw. Restoring Lightsail and preparing the gateway.</span>
          <div aria-hidden="true" className="provision-pending__bar">
            <span />
          </div>
        </div>
      ) : null}
      <button className="btn-primary onboarding-submit" disabled={isDisabled} type="submit">
        {isSubmitting || isRunning ? "Provisioning..." : "Fast Provision OpenClaw"}{" "}
        <span className="arrow">-&gt;</span>
      </button>
    </form>
  );
}
