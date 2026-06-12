"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type ProvisionFormProps = {
  errorMessage: string | null;
  next: string;
  startedAt?: string | null;
  status?: string | null;
};

const TARGET_PROVISION_SECONDS = 3 * 60;
const PROVISION_ERROR_CODES = new Set([
  "invalid_provision_target",
  "missing_avatar",
  "missing_fields",
  "missing_aws_access_key_id",
  "missing_aws_region",
  "missing_aws_secret_access_key",
  "missing_openclaw_lightsail_snapshot_name",
  "missing_openai_api_key",
  "openclaw_instance_not_found",
  "openclaw_provision_failed",
  "openclaw_provision_running",
  "openclaw_snapshot_not_found",
  "openclaw_snapshot_response_failed",
  "save_failed"
]);

function provisionStepUrl(next: string, error?: string) {
  const params = new URLSearchParams({
    next,
    step: "provision"
  });

  if (error) {
    params.set("error", error);
  }

  return `/onboarding?${params.toString()}`;
}

function isApiUrl(url: string) {
  try {
    return new URL(url, window.location.origin).pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

function errorCodeFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return "openclaw_provision_failed";
  }

  const error = typeof payload.error === "string" ? payload.error.trim() : "";

  if (PROVISION_ERROR_CODES.has(error) || error.startsWith("missing_")) {
    return error;
  }

  return "openclaw_provision_failed";
}

function formatTimer(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = String(safeSeconds % 60).padStart(2, "0");

  return `${minutes}:${seconds}`;
}

export function ProvisionForm({ errorMessage, next, startedAt, status }: ProvisionFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localStartedAt, setLocalStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [submitError, setSubmitError] = useState("");
  const isRunning = status === "running";
  const isDisabled = isRunning || isSubmitting;
  const parsedStartedAt = startedAt ? Date.parse(startedAt) : NaN;
  const effectiveStartedAt = Number.isFinite(parsedStartedAt) ? parsedStartedAt : localStartedAt;
  const elapsedSeconds = effectiveStartedAt ? Math.max(0, Math.floor((now - effectiveStartedAt) / 1000)) : 0;
  const remainingSeconds = Math.max(0, TARGET_PROVISION_SECONDS - elapsedSeconds);
  const timerProgress = Math.min(100, Math.round((elapsedSeconds / TARGET_PROVISION_SECONDS) * 100));
  const showPending = isSubmitting || isRunning;

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const interval = window.setInterval(() => {
      router.refresh();
    }, 10_000);

    return () => window.clearInterval(interval);
  }, [isRunning, router]);

  useEffect(() => {
    if (!showPending) {
      return;
    }

    setNow(Date.now());

    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [showPending]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isDisabled) {
      return;
    }

    setIsSubmitting(true);
    setLocalStartedAt(Date.now());
    setNow(Date.now());
    setSubmitError("");

    try {
      const response = await fetch("/api/openclaw/provision", {
        body: new FormData(event.currentTarget),
        credentials: "same-origin",
        method: "POST"
      });

      if (response.url && response.redirected && !isApiUrl(response.url)) {
        window.location.assign(response.url);
        return;
      }

      if (response.ok && response.url && !isApiUrl(response.url)) {
        window.location.assign(response.url);
        return;
      }

      const payload = await response.json().catch(() => null);

      window.location.assign(provisionStepUrl(next, errorCodeFromPayload(payload)));
    } catch {
      setSubmitError("Provisioning request could not be started. Check the server and try again.");
      setIsSubmitting(false);
      setLocalStartedAt(null);
    }
  }

  return (
    <form className="onboarding-form" method="post" noValidate onSubmit={handleSubmit}>
      <input name="next" type="hidden" value={next} />
      <div className="provision-summary">
        <strong>Fast AWS Lightsail provisioning</strong>
        <span>Prepares the OpenClaw environment with Telegram, identity, and Remotion settings in one streamlined provisioning flow.</span>
      </div>
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
      {submitError ? <p className="form-error">{submitError}</p> : null}
      {isRunning ? (
        <p className="form-success">
          Provisioning is running. This page will refresh automatically and move to approval when the instance is ready.
        </p>
      ) : null}
      {showPending ? (
        <div aria-live="polite" className="provision-pending">
          <span>Fast provisioning OpenClaw. Preparing the Lightsail environment and gateway.</span>
          <div aria-live="off" className="provision-timer">
            <div className="provision-timer__meta">
              <strong>{remainingSeconds > 0 ? `${formatTimer(remainingSeconds)} target remaining` : `${formatTimer(elapsedSeconds)} elapsed`}</strong>
              <span>
                {remainingSeconds > 0
                  ? "Expected to finish in under 3 minutes."
                  : "AWS is taking longer than expected. Keep this page open while SSH becomes ready."}
              </span>
            </div>
            <div
              aria-label={`Provisioning timer ${timerProgress}%`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={timerProgress}
              className="provision-timer__track"
              role="progressbar"
            >
              <span className="provision-timer__bar" style={{ width: `${timerProgress}%` }} />
            </div>
          </div>
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
