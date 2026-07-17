import "server-only";

import { deleteStoredAvatars } from "@/lib/avaturn";
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
 * The instance is torn down first: if that fails we abort with the account
 * still present, because an orphaned Lightsail instance nobody is billed for
 * and nobody can find is worse than a delete the admin can retry.
 */
export async function destroyUserWorkspaceForAdmin(adminSupabase: AdminSupabase, profile: AdminTargetProfile) {
  const instance = profile.openclaw_instance?.trim() ?? "";
  let destroyOutput: string | null = null;

  if (instance) {
    try {
      const destroyed = await destroyOpenClawInstance({
        instance,
        region: profile.openclaw_region
      });

      destroyOutput = destroyed.output;
    } catch (error) {
      if (!isOpenClawInstanceMissingError(error)) {
        throw error;
      }

      destroyOutput = `Stored instance ${instance} was already missing during admin workspace delete.`;
    }
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
