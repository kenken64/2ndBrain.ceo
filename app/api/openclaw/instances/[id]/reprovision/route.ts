import { NextResponse } from "next/server";
import { addConsumerOwner } from "@/lib/gyne-consumer-registry";
import { isAdminUser } from "@/lib/admin";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims, onboardingProfileSelect, type OnboardingProfile } from "@/lib/onboarding";
import { provisionHermes, provisionOpenClaw } from "@/lib/openclaw";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type InstanceRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type InstanceRow = {
  agent_type: string;
  consumer_name: string;
  created_at: string | null;
  id: string;
  instance: string | null;
  label: string | null;
  provision_error: string | null;
  provision_status: string;
  region: string | null;
  updated_at: string | null;
};

type ProvisionProfile = OnboardingProfile & {
  admin_deleted_at?: string | null;
  admin_disabled?: boolean | null;
  email?: string | null;
  llm_token_quota?: number | string | null;
  llm_token_used?: number | string | null;
};

const INSTANCE_COLUMNS =
  "id,agent_type,consumer_name,label,instance,region,provision_status,provision_error,created_at,updated_at";

function numericTokenValue(value: number | string | null | undefined) {
  const number = Number(value ?? 0);

  return Number.isFinite(number) ? number : 0;
}

function outputSummary(value: string) {
  return value.slice(-4000);
}

function serializeInstance(row: InstanceRow) {
  return {
    agentType: row.agent_type,
    consumerName: row.consumer_name,
    createdAt: row.created_at,
    error: row.provision_error,
    id: row.id,
    instance: row.instance,
    label: row.label,
    region: row.region,
    status: row.provision_status,
    updatedAt: row.updated_at
  };
}

async function requireUser() {
  if (!hasSupabaseEnv()) {
    return {
      response: NextResponse.json({ error: "Supabase is not configured" }, { status: 503 })
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);
  const email = typeof data?.claims?.email === "string" ? data.claims.email.toLowerCase() : "";

  if (error || !userId) {
    return {
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 })
    };
  }

  return { email, response: null, userId };
}

// Re-provision an existing instance row. Reuses provisionOpenClaw's self-heal: if the stored Lightsail
// instance still exists it is reused, otherwise a fresh one is restored from the snapshot. The row and
// its consumer name are preserved so Gyne Agent ownership and Telegram pairing stay stable.
export async function POST(_request: Request, context: InstanceRouteContext) {
  const auth = await requireUser();

  if (auth.response) {
    return auth.response;
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for AI Agent instances" },
      { status: 503 }
    );
  }

  const { id } = await context.params;
  const instanceId = id?.trim();

  if (!instanceId) {
    return NextResponse.json({ error: "instance_id_required" }, { status: 400 });
  }

  const adminSupabase = createAdminClient();
  const { data: row, error: rowError } = await adminSupabase
    .from("openclaw_instances")
    .select(INSTANCE_COLUMNS)
    .eq("id", instanceId)
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (rowError) {
    return NextResponse.json({ error: rowError.message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ error: "instance_not_found" }, { status: 404 });
  }

  const instanceRow = row as InstanceRow;

  if (instanceRow.provision_status === "provisioning") {
    return NextResponse.json({ error: "provision_running" }, { status: 409 });
  }

  const { data: profile, error: profileError } = await adminSupabase
    .from("profiles")
    .select(`${onboardingProfileSelect},admin_disabled,admin_deleted_at,email,llm_token_quota,llm_token_used`)
    .eq("id", auth.userId)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const provisionProfile = profile as ProvisionProfile | null;

  if (!provisionProfile) {
    return NextResponse.json({ error: "Profile was not found." }, { status: 404 });
  }

  if (provisionProfile.admin_disabled || provisionProfile.admin_deleted_at) {
    return NextResponse.json({ error: "Account access is disabled" }, { status: 403 });
  }

  const ownerName = provisionProfile.owner_name?.trim();
  const avatarName = provisionProfile.avatar_name?.trim();
  const avatarGender = provisionProfile.avatar_gender?.trim();
  // Re-provisioning reuses the profile's Telegram bot token; approve the fresh pairing code afterwards.
  let telegramBotToken = provisionProfile.telegram_bot_token?.trim();
  if (instanceRow.agent_type === "hermes_agent") {
    const { data: secret, error: secretError } = await adminSupabase.from("agent_instance_secrets")
      .select("telegram_bot_token").eq("instance_id", instanceRow.id).maybeSingle();
    if (secretError) return NextResponse.json({ error: "save_failed" }, { status: 500 });
    const storedToken = (secret as { telegram_bot_token: string } | null)?.telegram_bot_token?.trim();
    telegramBotToken = storedToken || (instanceRow.label === "Onboarding workspace" ? telegramBotToken : undefined);
  }

  if (
    !ownerName ||
    !avatarName ||
    !avatarGender ||
    !telegramBotToken ||
    !provisionProfile.avatar_glb_path?.trim() ||
    !provisionProfile.avatar_completed_at
  ) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const isAdmin = await isAdminUser(auth.email || provisionProfile.email, auth.userId);
  const availableTokens = Math.max(
    0,
    numericTokenValue(provisionProfile.llm_token_quota) - numericTokenValue(provisionProfile.llm_token_used)
  );

  if (!isAdmin && availableTokens <= 0) {
    return NextResponse.json({ error: "insufficient_ai_credits" }, { status: 402 });
  }

  // Serialize per user: clawmacdo restores are heavy and the underlying binary runs one at a time.
  const { data: siblingRows, error: siblingError } = await adminSupabase
    .from("openclaw_instances")
    .select("id,provision_status")
    .eq("user_id", auth.userId);

  if (siblingError) {
    return NextResponse.json({ error: siblingError.message }, { status: 500 });
  }

  const anotherProvisioning = ((siblingRows ?? []) as Array<{ id: string; provision_status: string }>).some(
    (sibling) => sibling.id !== instanceRow.id && sibling.provision_status === "provisioning"
  );

  if (anotherProvisioning) {
    return NextResponse.json({ error: "provision_running" }, { status: 409 });
  }

  await adminSupabase
    .from("openclaw_instances")
    .update({
      provision_error: null,
      provision_started_at: new Date().toISOString(),
      provision_status: "provisioning"
    })
    .eq("id", instanceRow.id);

  try {
    const provisioned = await (instanceRow.agent_type === "hermes_agent" ? provisionHermes : provisionOpenClaw)({
      avatarGender,
      avatarName,
      consumerName: instanceRow.consumer_name,
      // Self-heal: reuse the box if it still exists in Lightsail, else restore fresh from the snapshot.
      existingInstance: instanceRow.instance,
      onInstanceRestored: async (details) => {
        const { error: saveError } = await adminSupabase
          .from("openclaw_instances")
          .update({
            instance: details.instance,
            provision_output: outputSummary(details.restoreOutput),
            region: details.region,
            snapshot_name: details.snapshotName
          })
          .eq("id", instanceRow.id);
        if (saveError) throw new Error("save_failed");
      },
      ownerName,
      telegramBotToken
    });

    const completedAt = new Date().toISOString();
    const { data: readyRow, error: readyError } = await adminSupabase
      .from("openclaw_instances")
      .update({
        instance: provisioned.instance,
        provision_completed_at: completedAt,
        provision_error: null,
        provision_output: outputSummary(provisioned.restoreOutput),
        provision_status: "ready",
        region: provisioned.region,
        snapshot_name: provisioned.snapshotName
      })
      .eq("id", instanceRow.id)
      .select(INSTANCE_COLUMNS)
      .single();

    if (readyError || !readyRow) {
      return NextResponse.json({ error: readyError?.message ?? "save_failed" }, { status: 500 });
    }

    // Re-assert ownership (idempotent) so the consumer stays visible in the user's Gyne Agent.
    const mapped = await addConsumerOwner(auth.userId, instanceRow.consumer_name);
    if (!mapped && instanceRow.agent_type === "hermes_agent") throw new Error("gyne_owner_registration_failed");

    // A different instance name means the snapshot was restored fresh (the old host was missing), which
    // resets Telegram pairing. A matching name means the healthy host was reused and pairing is intact.
    const previousInstance = instanceRow.instance?.trim() ?? "";
    const restored = !previousInstance || provisioned.instance !== previousInstance;

    if (previousInstance && instanceRow.label === "Onboarding workspace") {
      const { error: profileUpdateError } = await adminSupabase.from("profiles").update({
        openclaw_instance: provisioned.instance,
        openclaw_region: provisioned.region,
        openclaw_snapshot_name: provisioned.snapshotName,
        openclaw_provision_status: "ready",
        openclaw_provision_completed_at: completedAt,
        ...(restored ? {
          onboarding_completed_at: null,
          openclaw_telegram_pair_completed_at: null,
          openclaw_telegram_pair_status: "pending"
        } : {})
      }).eq("id", auth.userId).eq("openclaw_instance", previousInstance);
      if (profileUpdateError) throw profileUpdateError;
    }

    return NextResponse.json(
      { instance: serializeInstance(readyRow as InstanceRow), restored },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "openclaw_provision_failed";

    console.error("[openclaw:instances] reprovision failed", { instanceId: instanceRow.id });
    await adminSupabase
      .from("openclaw_instances")
      .update({ provision_error: message.slice(0, 2000), provision_status: "failed" })
      .eq("id", instanceRow.id);

    return NextResponse.json({ error: "openclaw_provision_failed" }, { status: 500 });
  }
}
