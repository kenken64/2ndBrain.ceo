import "server-only";

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

function resetProfilePatch(destroyOutput: string | null) {
  return {
    admin_deleted_at: new Date().toISOString(),
    admin_disabled: true,
    avatar_completed_at: null,
    avatar_gender: null,
    avatar_glb_bytes: null,
    avatar_glb_downloaded_at: null,
    avatar_glb_path: null,
    avatar_name: null,
    avaturn_avatar_payload: null,
    avaturn_avatar_url: null,
    bedrock_token_last4: null,
    bedrock_token_updated_at: null,
    bedrock_token_updated_by: null,
    enrolment_completed_at: null,
    google_workspace_connected_at: null,
    onboarding_completed_at: null,
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
    openclaw_provision_output: destroyOutput ? outputSummary(destroyOutput) : null,
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
    openclaw_telegram_pair_status: null,
    owner_name: null,
    provision_target: null,
    telegram_bot_token: null
  };
}

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

  await adminSupabase.from("wiki_edges").delete().eq("user_id", profile.id);
  await adminSupabase.from("wiki_page_nodes").delete().eq("user_id", profile.id);
  await adminSupabase.from("wiki_nodes").delete().eq("user_id", profile.id);
  await adminSupabase.from("wiki_pages").delete().eq("user_id", profile.id);
  await adminSupabase.from("projects").delete().eq("user_id", profile.id);

  const { error } = await adminSupabase
    .from("profiles")
    .update(resetProfilePatch(destroyOutput))
    .eq("id", profile.id);

  if (error) {
    throw new Error(error.message);
  }

  return {
    destroyOutput
  };
}
