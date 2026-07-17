"use strict";

// Periodically asks the app to reclaim OpenClaw instances belonging to accounts
// that have sat without AI credits past the grace window.
//
// This process only schedules; the work happens in /api/internal/reap-instances
// so it can reuse the TypeScript OpenClaw helpers instead of reimplementing
// clawmacdo invocation and AWS env handling in CommonJS.
//
// The deadline lives in profiles.ai_credits_exhausted_at, not in a timer here,
// so restarts and redeploys never reset anyone's countdown.

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_START_DELAY_MS = 60 * 1000;

function positiveNumberEnv(name, fallback) {
  const raw = process.env[name]?.trim();

  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function enabledByEnv(name, fallback) {
  const raw = process.env[name]?.trim().toLowerCase();

  if (!raw) {
    return fallback;
  }

  return ["1", "true", "yes"].includes(raw);
}

function reaperUrl() {
  const port = process.env.PORT?.trim() || "3000";
  return `http://127.0.0.1:${port}/api/internal/reap-instances`;
}

function startInstanceReaper() {
  if (!enabledByEnv("INSTANCE_REAPER_ENABLED", true)) {
    console.info("[instance-reaper] disabled by INSTANCE_REAPER_ENABLED");
    return () => {};
  }

  const secret = process.env.INSTANCE_REAPER_SECRET?.trim();

  if (!secret) {
    console.info("[instance-reaper] INSTANCE_REAPER_SECRET not set; idle instances will not be reclaimed");
    return () => {};
  }

  const intervalMs = positiveNumberEnv("INSTANCE_REAPER_INTERVAL_MS", DEFAULT_INTERVAL_MS);
  let timer = null;
  let stopped = false;
  // A sweep tears down VMs one at a time and can outlast the interval; never
  // let a second sweep start on top of a running one.
  let running = false;

  async function sweep() {
    if (running || stopped) {
      return;
    }

    running = true;

    try {
      const response = await fetch(reaperUrl(), {
        headers: { "x-reaper-secret": secret },
        method: "POST"
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        console.error("[instance-reaper] sweep rejected", {
          error: payload?.error ?? null,
          status: response.status
        });
      } else if (payload?.reaped > 0) {
        console.info("[instance-reaper] reclaimed instances", {
          reaped: payload.reaped,
          scanned: payload.scanned
        });
      }
    } catch (error) {
      console.error("[instance-reaper] sweep failed", {
        error: error instanceof Error ? error.message : "unknown"
      });
    } finally {
      running = false;
    }
  }

  // Delay the first sweep so the app finishes booting and can serve the route.
  const startTimer = setTimeout(() => {
    void sweep();
    timer = setInterval(() => void sweep(), intervalMs);
  }, positiveNumberEnv("INSTANCE_REAPER_START_DELAY_MS", DEFAULT_START_DELAY_MS));

  console.info("[instance-reaper] started", { intervalMs });

  return () => {
    stopped = true;
    clearTimeout(startTimer);

    if (timer) {
      clearInterval(timer);
    }
  };
}

module.exports = {
  startInstanceReaper
};
