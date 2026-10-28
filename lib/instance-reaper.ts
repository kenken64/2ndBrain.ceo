import "server-only";

import { removeConsumerOwner } from "@/lib/gyne-consumer-registry";
import { REAPER_GRACE_DAYS } from "@/lib/instance-reaper-shared";
import { destroyOpenClawInstance, isOpenClawInstanceMissingError } from "@/lib/openclaw";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminSupabase = ReturnType<typeof createAdminClient>;

export { REAPER_GRACE_DAYS };

type ReapCandidate = {
  ai_credits_exhausted_at: string | null;
  email: string | null;
  id: string;
  openclaw_instance: string | null;
  openclaw_region: string | null;
};

export type ReapOutcome = {
  email: string | null;
  instance: string;
  reason: "destroyed" | "already_missing" | "failed";
  error?: string;
};

/**
 * Clears the AI Agent fields only. Enrolment (owner name, avatar, Telegram
 * token) is deliberately preserved: reaping reclaims the VM from an unfunded
 * account, it does not undo who the person is. Once they add credits they can
 * provision again without redoing onboarding.
 */
function reapProfilePatch() {
  return {
    openclaw_gateway_completed_at: null,
    openclaw_gateway_output: null,
    openclaw_gateway_url: null,
    openclaw_hooks_completed_at: null,
    openclaw_hooks_output: null,
    openclaw_identity_completed_at: null,
    openclaw_identity_error: null,
    openclaw_identity_output: null,
    openclaw_instance: null,
    openclaw_provision_completed_at: null,
    openclaw_provision_error: null,
    openclaw_provision_output: "Instance reclaimed after the account sat without AI credits past the grace window.",
    openclaw_provision_started_at: null,
    openclaw_provision_status: null,
    openclaw_region: null,
    openclaw_remotion_completed_at: null,
    openclaw_remotion_output: null,
    openclaw_remotion_url: null,
    openclaw_snapshot_name: null,
    openclaw_telegram_output: null,
    openclaw_telegram_pair_completed_at: null,
    openclaw_telegram_pair_error: null,
    openclaw_telegram_pair_output: null,
    openclaw_telegram_pair_started_at: null,
    openclaw_telegram_pair_status: null
  };
}

async function adminUserIds(adminSupabase: AdminSupabase) {
  const { data } = await adminSupabase.from("admin_users").select("user_id");
  return new Set(((data ?? []) as { user_id: string }[]).map((row) => row.user_id));
}

/**
 * Deletes AI Agent instances belonging to accounts that have sat at zero AI
 * credits for longer than the grace window.
 *
 * A Lightsail instance bills its plan whether or not it is running or used, and
 * nothing else tears one down, so without this an abandoned signup costs money
 * indefinitely. Admins are exempt, matching the provisioning gates.
 *
 * Safe to run concurrently: destroying an instance that is already gone is
 * treated as success, and the profile update is idempotent.
 */
export async function reapUnfundedInstances(adminSupabase: AdminSupabase, graceDays = REAPER_GRACE_DAYS) {
  const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await adminSupabase
    .from("profiles")
    .select("id,email,openclaw_instance,openclaw_region,ai_credits_exhausted_at")
    .not("openclaw_instance", "is", null)
    .not("ai_credits_exhausted_at", "is", null)
    .lt("ai_credits_exhausted_at", cutoff);

  if (error) {
    throw new Error(error.message);
  }

  const candidates = (data ?? []) as ReapCandidate[];

  if (candidates.length === 0) {
    return { outcomes: [] as ReapOutcome[], scanned: 0 };
  }

  const admins = await adminUserIds(adminSupabase);
  const outcomes: ReapOutcome[] = [];

  for (const candidate of candidates) {
    const instance = candidate.openclaw_instance?.trim();

    if (!instance || admins.has(candidate.id)) {
      continue;
    }

    let reason: ReapOutcome["reason"] = "destroyed";
    let failure: string | undefined;

    try {
      await destroyOpenClawInstance({ instance, region: candidate.openclaw_region });
    } catch (destroyError) {
      if (isOpenClawInstanceMissingError(destroyError)) {
        // The VM is already gone; the stale pointer is exactly what we want to clear.
        reason = "already_missing";
      } else {
        reason = "failed";
        failure = destroyError instanceof Error ? destroyError.message : "reap_failed";
      }
    }

    if (reason === "failed") {
      // Leave the row intact so the next sweep retries rather than orphaning a
      // live instance behind a cleared pointer.
      outcomes.push({ email: candidate.email, error: failure, instance, reason });
      continue;
    }

    const { data: instanceRows } = await adminSupabase
      .from("openclaw_instances")
      .select("id,consumer_name")
      .eq("user_id", candidate.id)
      .eq("instance", instance);

    for (const row of (instanceRows ?? []) as { consumer_name: string; id: string }[]) {
      await removeConsumerOwner(candidate.id, row.consumer_name);
      await adminSupabase.from("openclaw_instances").delete().eq("id", row.id);
    }

    await adminSupabase.from("profiles").update(reapProfilePatch()).eq("id", candidate.id);

    outcomes.push({ email: candidate.email, instance, reason });
  }

  return { outcomes, scanned: candidates.length };
}
