import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { checkOpenClawInstancePresence } from "@/lib/openclaw";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_MAX_INSTANCES = 5;
// A provision that has been "provisioning" longer than this is treated as crashed and flipped to failed
// so it stops blocking new provisions/re-provisions. Comfortably above the max clawmacdo restore time.
const STALE_PROVISION_MS = 30 * 60 * 1000;
const INSTANCE_MISSING_MESSAGE =
  "The Lightsail host for this instance no longer exists. Re-provision to restore it.";
const PROVISION_TIMED_OUT_MESSAGE = "Provisioning did not finish in time. Re-provision to try again.";

type InstanceRow = {
  agent_type: string;
  consumer_name: string;
  created_at: string | null;
  id: string;
  instance: string | null;
  label: string | null;
  provision_error: string | null;
  provision_started_at: string | null;
  provision_status: string;
  region: string | null;
  updated_at: string | null;
};

const INSTANCE_COLUMNS =
  "id,agent_type,consumer_name,label,instance,region,provision_status,provision_error,provision_started_at,created_at,updated_at";

function maxInstancesPerUser() {
  const raw = Number(process.env.OPENCLAW_MAX_INSTANCES_PER_USER);

  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_INSTANCES;
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

function isStaleProvisioning(row: InstanceRow, now: number) {
  if (row.provision_status !== "provisioning") {
    return false;
  }

  const startedAt = row.provision_started_at ? Date.parse(row.provision_started_at) : Number.NaN;

  // Without a start time we cannot prove it is stale; leave it alone.
  const limit = row.agent_type === "hermes_agent" ? 65 * 60 * 1000 : STALE_PROVISION_MS;
  return Number.isFinite(startedAt) && now - startedAt > limit;
}

async function requireUserId() {
  if (!hasSupabaseEnv()) {
    return {
      response: NextResponse.json({ error: "Supabase is not configured" }, { status: 503 })
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);

  if (error || !userId) {
    return {
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 })
    };
  }

  return { response: null, userId };
}

// Reconcile stored instance rows against Lightsail: flip "ready" rows whose host was deleted, and stuck
// "provisioning" rows, to "failed" with a clear message so the UI can prompt Re-provision. Read-side
// self-healing — safe to call on every panel load; unknown AWS states are left untouched.
export async function POST() {
  const auth = await requireUserId();

  if (auth.response) {
    return auth.response;
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for AI Agent instances" },
      { status: 503 }
    );
  }

  const adminSupabase = createAdminClient();
  const { data, error } = await adminSupabase
    .from("openclaw_instances")
    .select(INSTANCE_COLUMNS)
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as InstanceRow[];
  const now = Date.now();

  // Probe Lightsail only for rows that claim to be usable. "missing" is definitive; "unknown" (transient
  // AWS error) is deliberately ignored so a healthy instance is never wrongly failed.
  const presenceByRow = new Map<string, Awaited<ReturnType<typeof checkOpenClawInstancePresence>>>();
  await Promise.all(
    rows
      .filter((row) => row.provision_status === "ready")
      .map(async (row) => {
        presenceByRow.set(row.id, await checkOpenClawInstancePresence(row.instance, row.region));
      })
  );

  const reconciled: InstanceRow[] = [];
  const updates: Array<PromiseLike<unknown>> = [];

  for (const row of rows) {
    let next = row;

    if (row.provision_status === "ready" && presenceByRow.get(row.id) === "missing") {
      next = { ...row, provision_error: INSTANCE_MISSING_MESSAGE, provision_status: "failed" };
    } else if (isStaleProvisioning(row, now)) {
      next = { ...row, provision_error: PROVISION_TIMED_OUT_MESSAGE, provision_status: "failed" };
    }

    if (next !== row) {
      updates.push(
        adminSupabase
          .from("openclaw_instances")
          .update({ provision_error: next.provision_error, provision_status: next.provision_status })
          .eq("id", row.id)
          .eq("user_id", auth.userId)
      );
    }

    reconciled.push(next);
  }

  if (updates.length > 0) {
    await Promise.all(updates);
  }

  return NextResponse.json(
    {
      instances: reconciled.map(serializeInstance),
      maxInstances: maxInstancesPerUser(),
      reconciled: updates.length
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
