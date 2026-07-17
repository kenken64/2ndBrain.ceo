/**
 * How long an account may sit at zero AI credits before its OpenClaw instance
 * is reclaimed.
 *
 * Kept out of lib/instance-reaper.ts (which is server-only) so the warning
 * banner can count down against the same number the sweep enforces.
 */
export const REAPER_GRACE_DAYS = 2;
