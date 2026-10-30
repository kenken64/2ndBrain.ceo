"use client";

import { Localized, LocalizedMessage } from "@/components/language-provider";


import { useState } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";

type BackfillWikiIngestButtonProps = {
  projectId: string;
  prompt?: string;
};

export function BackfillWikiIngestButton({ projectId, prompt }: BackfillWikiIngestButtonProps) {
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [error, setError] = useState("");

  async function handleBackfill() {
    if (isBackfilling) {
      return;
    }

    setIsBackfilling(true);
    setError("");

    try {
      const response = await fetch("/api/wiki/ingest/backfill", {
        body: JSON.stringify({ projectId, prompt }),
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Nth Brain backfill failed");
      }

      window.location.reload();
    } catch (backfillError) {
      setError(backfillError instanceof Error ? backfillError.message : "Nth Brain backfill failed");
      setIsBackfilling(false);
    }
  }

  return (
    <span className="wiki-backfill-action">
      <button
        className="btn-ghost btn-ghost--compact"
        disabled={isBackfilling}
        onClick={handleBackfill}
        type="button"
      >
        {isBackfilling ? <LoaderCircle className="spin-icon" size={15} strokeWidth={1.8} /> : <RotateCcw size={15} strokeWidth={1.8} />}
        {isBackfilling ? <Localized en={"Retrying..."} zh={"正在重试..."} /> : <Localized en={"Retry saved upload"} zh={"重试已保存的上传"} />}
      </button>
      {error ? <span className="form-error"><LocalizedMessage text={error} /></span> : null}
    </span>
  );
}
