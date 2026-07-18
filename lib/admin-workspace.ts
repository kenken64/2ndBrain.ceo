import "server-only";

import { deleteStoredAvatars } from "@/lib/avaturn";
import { removeConsumerOwner } from "@/lib/gyne-consumer-registry";
import { destroyOpenClawInstance, isOpenClawInstanceMissingError } from "@/lib/openclaw";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminSupabase = ReturnType<typeof createAdminClient>;

export type AdminTargetProfile = {
  email: string | null;
  id: string;
  openclaw_instance: string | null;
  openclaw_region: string | null;
};

function outputSummary(value: string) {
  return value.slice(-4000);
}

export function bedrockTokenLast4(value: string) {
  const trimmed = value.trim();
  return trimmed.length <= 4 ? trimmed : trimmed.slice(-4);
}

export async function getAdminTargetProfile(adminSupabase: AdminSupabase, userId: string) {
  const { data, error } = await adminSupabase
    .from("profiles")
    .select("id,email,openclaw_instance,openclaw_region")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("target_user_not_found");
  }

  return data as AdminTargetProfile;
}

/**
 * Deletes the account outright so the person can sign up again from scratch.
 *
 * Deleting the auth user is the whole operation: every user-owned table
 * (profiles, projects, wiki_*, credit_ledger, openclaw_instances,
 * marketplace_installs, admin_users, ...) carries an on-delete-cascade foreign
 * key back to auth.users, so the rows go with it. admin_audit_events is
 * deliberately on-delete-set-null instead, which keeps the audit trail intact
 * with target_email standing in for the removed id.
 *
 * Instances are torn down first — every VM the account owns, not just the
 * onboarding one, since the cascade erases the openclaw_instances rows and an
 * unrecorded Lightsail instance would bill forever with nothing left pointing
 * at it. If a teardown fails we abort with the account still present, so the
 * admin can retry.
 */
export async function destroyUserWorkspaceForAdmin(adminSupabase: AdminSupabase, profile: AdminTargetProfile) {
  const { data: instanceRows } = await adminSupabase
    .from("openclaw_instances")
    .select("consumer_name,instance,region")
    .eq("user_id", profile.id);
  const rows = (instanceRows ?? []) as Array<{
    consumer_name: string;
    instance: string | null;
    region: string | null;
  }>;

  const targets = new Map<string, string | null>();
  const profileInstance = profile.openclaw_instance?.trim();

  if (profileInstance) {
    targets.set(profileInstance, profile.openclaw_region);
  }

  for (const row of rows) {
    const name = row.instance?.trim();

    if (name && !targets.has(name)) {
      targets.set(name, row.region);
    }
  }

  let destroyOutput: string | null = null;

  const appendOutput = (chunk: string) => {
    destroyOutput = destroyOutput ? `${destroyOutput}\n${chunk}` : chunk;
  };

  for (const [name, region] of targets) {
    try {
      const destroyed = await destroyOpenClawInstance({ instance: name, region });
      appendOutput(destroyed.output);
    } catch (error) {
      if (!isOpenClawInstanceMissingError(error)) {
        throw error;
      }

      appendOutput(`Stored instance ${name} was already missing during admin workspace delete.`);
    }
  }

  // The auth.users cascade cannot reach Redis: without this the Gyne owner
  // sets keep listing consumers whose account and VMs no longer exist.
  for (const row of rows) {
    await removeConsumerOwner(profile.id, row.consumer_name);
  }

  const { error } = await adminSupabase.auth.admin.deleteUser(profile.id);

  if (error) {
    throw new Error(error.message);
  }

  // Not reachable by cascade: the GLB lives on disk, not in Postgres.
  const avatarsDeleted = await deleteStoredAvatars(profile.id);

  return {
    avatarsDeleted,
    destroyOutput: destroyOutput ? outputSummary(destroyOutput) : null
  };
}
