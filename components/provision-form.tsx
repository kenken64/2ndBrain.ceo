"use client";

import { Localized, LocalizedMessage, useLanguage } from "@/components/language-provider";


import { navigateToPage } from "@/lib/page-navigation";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type ProvisionFormProps = {
  agentType?: string | null;
  errorMessage: string | null;
  next: string;
  startedAt?: string | null;
  status?: string | null;
};

const TARGET_PROVISION_SECONDS = 3 * 60;
const PROVISION_ERROR_CODES = new Set([
  "insufficient_ai_credits",
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

// Same condition, two names: the middleware credit gate in proxy.ts answers
// with ai_credits_required, while the onboarding step and the provision route
// call it insufficient_ai_credits. Normalise so there is one message for it.
const ERROR_CODE_ALIASES: Record<string, string> = {
  ai_credits_required: "insufficient_ai_credits"
};

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
  if (!payload || typeof payload !== "object") {
    return "openclaw_provision_failed";
  }

  // The provision route puts its code in `error`, but middleware gates answer
  // with prose in `error` and the machine-readable value in `code`. Reading
  // only `error` threw the precise reason away and fell back to the generic
  // "provisioning failed", which sends people to check clawmacdo output when
  // the real cause is a gate they can act on.
  const candidates = [
    "code" in payload && typeof payload.code === "string" ? payload.code.trim() : "",
    "error" in payload && typeof payload.error === "string" ? payload.error.trim() : ""
  ];

  for (const candidate of candidates) {
    const normalized = ERROR_CODE_ALIASES[candidate] ?? candidate;

    if (PROVISION_ERROR_CODES.has(normalized) || normalized.startsWith("missing_")) {
      return normalized;
    }
  }

  return "openclaw_provision_failed";
}

function formatTimer(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = String(safeSeconds % 60).padStart(2, "0");

  return `${minutes}:${seconds}`;
}

export function ProvisionForm({ agentType, errorMessage, next, startedAt, status }: ProvisionFormProps) {
  const _uiLanguage = useLanguage().language;
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
        navigateToPage(response.url);
        return;
      }

      if (response.ok && response.url && !isApiUrl(response.url)) {
        navigateToPage(response.url);
        return;
      }

      const payload = await response.json().catch(() => null);

      navigateToPage(provisionStepUrl(next, errorCodeFromPayload(payload)));
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
        <strong>{agentType === "hermes_agent" ? <Localized en="Hermes cloud provisioning" zh="Hermes 云端配置" /> : <Localized en={"Fast Cloud provisioning"} zh={"快速云端配置"} />}</strong>
        <span>{agentType === "hermes_agent" ? <Localized en="Restores Hermes and configures your Telegram bot and Gyne worker." zh="恢复 Hermes 并配置您的 Telegram 机器人和 Gyne 工作进程。" /> : <Localized en={"Prepares the AI Agent environment with Telegram, identity, and Remotion settings in one streamlined provisioning flow."} zh={"通过精简的配置流程准备 AI Agent 环境，包括 Telegram、身份和 Remotion 设置。"} />}</span>
      </div>
      {errorMessage ? <p className="form-error"><LocalizedMessage text={errorMessage} /></p> : null}
      {submitError ? <p className="form-error"><LocalizedMessage text={submitError} /></p> : null}
      {isRunning ? (
        <p className="form-success">
          <Localized en={"Provisioning is running. This page will refresh automatically and move to approval when the instance is ready."} zh={"正在配置。实例就绪后，此页面将自动刷新并进入批准步骤。"} /></p>
      ) : null}
      {showPending ? (
        <div aria-live="polite" className="provision-pending">
          <span>{agentType === "hermes_agent" ? <Localized en="Restoring Hermes and installing the Gyne worker. This can take several minutes." zh="正在恢复 Hermes 并安装 Gyne 工作进程，可能需要数分钟。" /> : <Localized en={"Fast provisioning AI Agent. Preparing the Cloud environment and gateway."} zh={"正在快速配置 AI Agent，并准备云环境和网关。"} />}</span>
          <div aria-live="off" className="provision-timer">
            <div className="provision-timer__meta">
              <strong>{remainingSeconds > 0 ? (_uiLanguage === "zh" ? `预计剩余 ${formatTimer(remainingSeconds)}` : `${formatTimer(remainingSeconds)} target remaining`) : (_uiLanguage === "zh" ? `已用时 ${formatTimer(elapsedSeconds)}` : `${formatTimer(elapsedSeconds)} elapsed`)}</strong>
              <span>
                {remainingSeconds > 0
                  ? agentType === "hermes_agent" ? <Localized en="Building and starting the worker may take longer." zh="构建并启动工作进程可能需要更长时间。" /> : <Localized en={"Expected to finish in under 3 minutes."} zh={"预计在 3 分钟内完成。"} />
                  : <Localized en={"Cloud provisioning is taking longer than expected. Keep this page open while SSH becomes ready."} zh={"云端配置所需时间比预期更长。请保持页面打开，等待 SSH 就绪。"} />}
              </span>
            </div>
            <div
              aria-label={_uiLanguage === "zh" ? `配置进度 ${timerProgress}%` : `Provisioning timer ${timerProgress}%`}
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
        {isSubmitting || isRunning ? <Localized en={"Provisioning..."} zh={"正在配置..."} /> : agentType === "hermes_agent" ? <Localized en="Provision Hermes Agent" zh="配置 Hermes Agent" /> : <Localized en={"Fast Provision AI Agent"} zh={"快速配置 AI Agent"} />}{" "}
        <span className="arrow">-&gt;</span>
      </button>
    </form>
  );
}
