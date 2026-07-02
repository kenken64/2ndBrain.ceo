import { NextResponse } from "next/server";
import { addConsumerOwner } from "@/lib/gyne-consumer-registry";
import { isAdminUser } from "@/lib/admin";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims, onboardingProfileSelect, type OnboardingProfile } from "@/lib/onboarding";
import { generateConsumerName, provisionOpenClaw } from "@/lib/openclaw";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_MAX_INSTANCES = 5;
// Statuses that count against the per-user instance cap (failed/stopped instances do not).
const ACTIVE_STATUSES = ["provisioning", "ready", "deprovisioning"];

type InstanceRow = {
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

function maxInstancesPerUser() {
  const raw = Number(process.env.OPENCLAW_MAX_INSTANCES_PER_USER);

  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_INSTANCES;
}

function isValidTelegramBotToken(value: string) {
  return value.length <= 256 && /^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(value);
}

function numericTokenValue(value: number | string | null | undefined) {
  const number = Number(value ?? 0);

  return Number.isFinite(number) ? number : 0;
}

function outputSummary(value: string) {
  return value.slice(-4000);
}

function serializeInstance(row: InstanceRow) {
  return {
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

export async function GET() {
  const auth = await requireUser();

  if (auth.response) {
    return auth.response;
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for OpenClaw instances" },
      { status: 503 }
    );
  }

  const adminSupabase = createAdminClient();
  const { data, error } = await adminSupabase
    .from("openclaw_instances")
    .select("id,consumer_name,label,instance,region,provision_status,provision_error,created_at,updated_at")
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const instances = ((data ?? []) as InstanceRow[]).map(serializeInstance);

  return NextResponse.json(
    { instances, maxInstances: maxInstancesPerUser() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const auth = await requireUser();

  if (auth.response) {
    return auth.response;
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for OpenClaw instances" },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { label?: unknown; telegramBotToken?: unknown };
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) || null : null;
  const bodyTelegramBotToken = typeof body.telegramBotToken === "string" ? body.telegramBotToken.trim() : "";

  if (bodyTelegramBotToken && !isValidTelegramBotToken(bodyTelegramBotToken)) {
    return NextResponse.json({ error: "invalid_telegram_bot_token" }, { status: 400 });
  }

  const adminSupabase = createAdminClient();
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
  // Each instance can pair with its own Telegram bot: a token supplied with the request wins over the
  // profile token captured during onboarding.
  const telegramBotToken = bodyTelegramBotToken || provisionProfile.telegram_bot_token?.trim();

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

  const { data: existingRows, error: existingError } = await adminSupabase
    .from("openclaw_instances")
    .select("id,provision_status")
    .eq("user_id", auth.userId);

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const rows = (existingRows ?? []) as Array<{ id: string; provision_status: string }>;

  // Serialize per user: clawmacdo restores are heavy and the underlying binary runs one at a time.
  if (rows.some((row) => row.provision_status === "provisioning")) {
    return NextResponse.json({ error: "provision_running" }, { status: 409 });
  }

  const activeCount = rows.filter((row) => ACTIVE_STATUSES.includes(row.provision_status)).length;

  if (activeCount >= maxInstancesPerUser()) {
    return NextResponse.json(
      { error: "instance_limit_reached", maxInstances: maxInstancesPerUser() },
      { status: 409 }
    );
  }

  const consumerName = generateConsumerName(auth.userId);
  const { data: inserted, error: insertError } = await adminSupabase
    .from("openclaw_instances")
    .insert({
      consumer_name: consumerName,
      label,
      provision_started_at: new Date().toISOString(),
      provision_status: "provisioning",
      user_id: auth.userId
    })
    .select("id,consumer_name,label,instance,region,provision_status,provision_error,created_at,updated_at")
    .single();

  if (insertError || !inserted) {
    return NextResponse.json({ error: insertError?.message ?? "insert_failed" }, { status: 500 });
  }

  const instanceRow = inserted as InstanceRow;

  try {
    const provisioned = await provisionOpenClaw({
      avatarGender,
      avatarName,
      consumerName,
      onInstanceRestored: async (details) => {
        await adminSupabase
          .from("openclaw_instances")
          .update({
            instance: details.instance,
            provision_output: outputSummary(details.restoreOutput),
            region: details.region,
            snapshot_name: details.snapshotName
          })
          .eq("id", instanceRow.id);
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
      .select("id,consumer_name,label,instance,region,provision_status,provision_error,created_at,updated_at")
      .single();

    if (readyError || !readyRow) {
      return NextResponse.json({ error: readyError?.message ?? "save_failed" }, { status: 500 });
    }

    // Ownership map is authoritative here: only after a successful provision does the consumer become
    // visible to this user in the Gyne Agent.
    await addConsumerOwner(auth.userId, consumerName);

    return NextResponse.json({ instance: serializeInstance(readyRow as InstanceRow) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "openclaw_provision_failed";

    console.error("[openclaw:instances] provision failed", { instanceId: instanceRow.id });
    await adminSupabase
      .from("openclaw_instances")
      .update({ provision_error: message.slice(0, 2000), provision_status: "failed" })
      .eq("id", instanceRow.id);

    return NextResponse.json({ error: "openclaw_provision_failed" }, { status: 500 });
  }
}
