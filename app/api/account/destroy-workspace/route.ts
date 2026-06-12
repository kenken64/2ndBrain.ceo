import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims, onboardingPath } from "@/lib/onboarding";
import { destroyOpenClawInstance, isOpenClawInstanceMissingError } from "@/lib/openclaw";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function outputSummary(value: string) {
  return value.slice(-4000);
}

function resetProfilePatch(destroyOutput: string | null) {
  return {
    avatar_completed_at: null,
    avatar_gender: null,
    avatar_glb_bytes: null,
    avatar_glb_downloaded_at: null,
    avatar_glb_path: null,
    avatar_name: null,
    avaturn_avatar_payload: null,
    avaturn_avatar_url: null,
    enrolment_completed_at: null,
    google_workspace_connected_at: null,
    onboarding_completed_at: null,
    openclaw_hooks_completed_at: null,
    openclaw_hooks_output: null,
    openclaw_gateway_completed_at: null,
    openclaw_gateway_output: null,
    openclaw_gateway_url: null,
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

export async function POST(request: Request) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(claimsData?.claims);

  if (claimsError || !userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("openclaw_instance,openclaw_region")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const instance =
    typeof profile?.openclaw_instance === "string" ? profile.openclaw_instance.trim() : "";
  const region = typeof profile?.openclaw_region === "string" ? profile.openclaw_region : null;
  let destroyOutput: string | null = null;

  if (instance) {
    try {
      const destroyed = await destroyOpenClawInstance({
        instance,
        region
      });

      destroyOutput = destroyed.output;
    } catch (error) {
      if (!isOpenClawInstanceMissingError(error)) {
        const message = error instanceof Error ? error.message : "openclaw_destroy_failed";

        return NextResponse.json({ error: message }, { status: 500 });
      }

      destroyOutput = `Stored instance ${instance} was already missing during workspace reset.`;
    }
  }

  await supabase.from("wiki_edges").delete().eq("user_id", userId);
  await supabase.from("wiki_page_nodes").delete().eq("user_id", userId);
  await supabase.from("wiki_nodes").delete().eq("user_id", userId);
  await supabase.from("wiki_pages").delete().eq("user_id", userId);
  await supabase.from("projects").delete().eq("user_id", userId);

  const { error: resetError } = await supabase
    .from("profiles")
    .update(resetProfilePatch(destroyOutput))
    .eq("id", userId);

  if (resetError) {
    return NextResponse.json({ error: resetError.message }, { status: 500 });
  }

  await supabase.auth.signOut();

  return NextResponse.json({
    ok: true,
    redirectTo: `/login?next=${encodeURIComponent(onboardingPath("/dashboard", "enrolment"))}`
  });
}
