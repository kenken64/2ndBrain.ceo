"use client";

import { FormEvent, useState } from "react";

type ProvisionFormProps = {
  errorMessage: string | null;
  next: string;
  status?: string | null;
};

export function ProvisionForm({ errorMessage, next, status }: ProvisionFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const isRunning = status === "running";
  const isDisabled = isRunning || isSubmitting;

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
        <strong>AWS Lightsail snapshot restore</strong>
        <span>AWS, OpenAI, snapshot, Remotion, hooks, and prompt settings are read from server environment variables.</span>
      </div>
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
      {submitError ? <p className="form-error">{submitError}</p> : null}
      {isRunning ? <p className="form-success">Provisioning is already running.</p> : null}
      {isSubmitting ? (
        <div aria-live="polite" className="provision-pending">
          <span>Provisioning OpenClaw. Restoring Lightsail and waiting for SSH readiness.</span>
          <div aria-hidden="true" className="provision-pending__bar">
            <span />
          </div>
        </div>
      ) : null}
      <button className="btn-primary onboarding-submit" disabled={isDisabled} type="submit">
        {isSubmitting ? "Provisioning..." : "Provision OpenClaw"}{" "}
        <span className="arrow">-&gt;</span>
      </button>
    </form>
  );
}
