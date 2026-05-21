"use client";

import { useState } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";

type BackfillWikiIngestButtonProps = {
  projectId: string;
};

export function BackfillWikiIngestButton({ projectId }: BackfillWikiIngestButtonProps) {
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
        body: JSON.stringify({ projectId }),
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
        {isBackfilling ? "Backfilling..." : "Backfill upload"}
      </button>
      {error ? <span className="form-error">{error}</span> : null}
    </span>
  );
}
