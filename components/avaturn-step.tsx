"use client";

import { useEffect, useState } from "react";

const AVATURN_ORIGIN = "https://2ndbrainceo.avaturn.dev";
const AVATURN_IFRAME_URL = `${AVATURN_ORIGIN}/login`;

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

function getAvatarUrl(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (typeof record.url === "string") {
    return record.url;
  }

  if (typeof record.avatarUrl === "string") {
    return record.avatarUrl;
  }

  if (typeof record.glbUrl === "string") {
    return record.glbUrl;
  }

  return null;
}

type AvaturnStepProps = {
  errorMessage?: string | null;
  next: string;
};

export function AvaturnStep({ errorMessage, next }: AvaturnStepProps) {
  const [avatarUrl, setAvatarUrl] = useState("");
  const [payloadJson, setPayloadJson] = useState("");

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== AVATURN_ORIGIN) {
        return;
      }

      const payload = parseAvaturnPayload(event.data);
      const exportedUrl = getAvatarUrl(payload);

      if (!exportedUrl) {
        return;
      }

      setAvatarUrl(exportedUrl);
      setPayloadJson(JSON.stringify(payload));
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return (
    <>
      <div className="avaturn-frame-shell">
        <iframe
          allow="camera *; microphone *; clipboard-write"
          allowFullScreen
          className="avaturn-frame"
          src={AVATURN_IFRAME_URL}
          title="Avaturn avatar creator"
        />
      </div>
      <form action="/api/onboarding" className="onboarding-form onboarding-form--center" method="post">
        <input name="step" type="hidden" value="avatar" />
        <input name="next" type="hidden" value={next} />
        <input name="avaturnAvatarUrl" type="hidden" value={avatarUrl} />
        <input name="avaturnPayload" type="hidden" value={payloadJson} />
        {avatarUrl ? (
          <p className="form-success">Avatar exported. You can finish setup now.</p>
        ) : errorMessage ? (
          <p className="form-error">{errorMessage}</p>
        ) : null}
        <button className="btn-primary onboarding-submit" disabled={!avatarUrl} type="submit">
          Finish setup <span className="arrow">-&gt;</span>
        </button>
      </form>
    </>
  );
}
