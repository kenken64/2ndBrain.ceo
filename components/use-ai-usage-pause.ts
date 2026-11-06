"use client";

import { useEffect, useState } from "react";

// Recheck when returning from Settings or when another tab changes the pause state.
// APIs independently enforce the pause even before this display refresh completes.
export function useAiUsagePause(initialPaused = false) {
  const [paused, setPaused] = useState(initialPaused);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    async function refresh() {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const response = await fetch("/api/settings/token-balance", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (!disposed && typeof payload?.pause?.openclawTokensPaused === "boolean") {
          setPaused(payload.pause.openclawTokensPaused);
        }
      } catch {
        // Keep the latest known state when offline; server checks still apply.
      } finally {
        pending = false;
      }
    }
    void refresh();
    const interval = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return [paused, setPaused] as const;
}
