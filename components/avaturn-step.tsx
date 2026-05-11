"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

function getAvaturnConfig() {
  const configuredUrl = process.env.NEXT_PUBLIC_AVATURN_URL?.trim();

  if (!configuredUrl) {
    return null;
  }

  try {
    const url = new URL(configuredUrl);

    if (url.protocol !== "https:") {
      return null;
    }

    return {
      iframeUrl: url.toString(),
      origin: url.origin
    };
  } catch {
    return null;
  }
}

function parseAvaturnPayload(data: unknown) {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }

  return data;
}

function getAvatarUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const directKeys = [
    "url",
    "avatarUrl",
    "avatar_url",
    "glbUrl",
    "glb_url",
    "modelUrl",
    "model_url",
    "downloadUrl",
    "download_url",
    "fileUrl",
    "file_url"
  ];

  for (const key of directKeys) {
    if (typeof record[key] === "string") {
      return record[key];
    }
  }

  for (const key of ["data", "payload", "avatar", "export", "result", "file"]) {
    const nestedUrl: string | null = getAvatarUrl(record[key]);

    if (nestedUrl) {
      return nestedUrl;
    }
  }

  const json = JSON.stringify(record);
  const glbMatch = json.match(/https:\/\/[^"\\\s]+\.glb(?:\?[^"\\\s]*)?/i);

  return glbMatch?.[0] ?? null;
}

type AvaturnStepProps = {
  errorMessage?: string | null;
  next: string;
};

export function AvaturnStep({ errorMessage, next }: AvaturnStepProps) {
  const avaturnConfig = useMemo(() => getAvaturnConfig(), []);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avaturnMessage, setAvaturnMessage] = useState("");
  const [payloadJson, setPayloadJson] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit = Boolean(avatarUrl);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!canSubmit) {
      event.preventDefault();
      setAvaturnMessage("Complete Avaturn and export the avatar as GLB before continuing.");
      return;
    }

    setIsSubmitting(true);
  }

  useEffect(() => {
    if (!avaturnConfig) {
      return;
    }

    const avaturnOrigin = avaturnConfig.origin;

    function handleMessage(event: MessageEvent) {
      if (event.origin !== avaturnOrigin) {
        return;
      }

      const payload = parseAvaturnPayload(event.data);
      const exportedUrl = getAvatarUrl(payload);

      if (!exportedUrl) {
        setAvaturnMessage("Avaturn is still in progress. Export the avatar as GLB to continue.");
        return;
      }

      setAvatarUrl(exportedUrl);
      setAvaturnMessage("");
      setPayloadJson(JSON.stringify(payload));
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [avaturnConfig]);

  if (!avaturnConfig) {
    return (
      <p className="form-error">
        Avaturn is not configured. Set NEXT_PUBLIC_AVATURN_URL in the environment.
      </p>
    );
  }

  return (
    <>
      <div className="avaturn-frame-shell">
        <iframe
          allow="camera *; microphone *; clipboard-write"
          allowFullScreen
          className="avaturn-frame"
          src={avaturnConfig.iframeUrl}
          title="Avaturn avatar creator"
        />
      </div>
      <p className="avaturn-helper">
        Complete the Avaturn flow and export the avatar as GLB. We will capture the exported
        avatar automatically and save it for OpenClaw.
      </p>
      <form
        action="/api/onboarding"
        className="onboarding-form onboarding-form--center"
        method="post"
        noValidate
        onSubmit={handleSubmit}
      >
        <input name="step" type="hidden" value="avatar" />
        <input name="next" type="hidden" value={next} />
        <input name="avaturnAvatarUrl" type="hidden" value={avatarUrl} />
        <input name="avaturnPayload" type="hidden" value={payloadJson} />
        {isSubmitting ? (
          <div
            aria-live="polite"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={66}
            className="submit-progress"
            role="progressbar"
          >
            <div className="submit-progress__meta">
              <strong>Saving avatar</strong>
              <span>Export received. Downloading the GLB and storing it for OpenClaw.</span>
            </div>
            <div className="submit-progress__track">
              <span className="submit-progress__bar" />
            </div>
          </div>
        ) : avatarUrl ? (
          <p className="form-success">Avatar exported. You can finish setup now.</p>
        ) : avaturnMessage ? (
          <p className="form-error">{avaturnMessage}</p>
        ) : errorMessage ? (
          <p className="form-error">{errorMessage}</p>
        ) : null}
        <button className="btn-primary onboarding-submit" disabled={!canSubmit || isSubmitting} type="submit">
          {isSubmitting ? "Saving avatar..." : "Finish setup"} <span className="arrow">-&gt;</span>
        </button>
      </form>
    </>
  );
}
