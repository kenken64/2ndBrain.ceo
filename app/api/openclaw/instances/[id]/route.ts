import { NextResponse } from "next/server";
import { removeConsumerOwner } from "@/lib/gyne-consumer-registry";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { destroyOpenClawInstance, isOpenClawInstanceMissingError } from "@/lib/openclaw";
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
  consumer_name: string;
  id: string;
  instance: string | null;
  region: string | null;
};

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

export async function DELETE(_request: Request, context: InstanceRouteContext) {
  const auth = await requireUserId();

  if (auth.response) {
    return auth.response;
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for OpenClaw instances" },
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
    .select("id,consumer_name,instance,region")
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

  // Remove the ownership mapping first so the consumer immediately disappears from the user's Gyne
  // Agent listing, even if the Lightsail teardown below is slow or fails.
  await removeConsumerOwner(auth.userId, instanceRow.consumer_name);

  await adminSupabase
    .from("openclaw_instances")
    .update({ provision_status: "deprovisioning" })
    .eq("id", instanceRow.id);

  if (instanceRow.instance?.trim()) {
    try {
      await destroyOpenClawInstance({
        instance: instanceRow.instance.trim(),
        region: instanceRow.region
      });
    } catch (error) {
      if (!isOpenClawInstanceMissingError(error)) {
        const message = error instanceof Error ? error.message : "openclaw_deprovision_failed";

        console.error("[openclaw:instances] deprovision failed", { instanceId: instanceRow.id });
        await adminSupabase
          .from("openclaw_instances")
          .update({ provision_error: message.slice(0, 2000), provision_status: "failed" })
          .eq("id", instanceRow.id);

        return NextResponse.json({ error: "openclaw_deprovision_failed" }, { status: 500 });
      }
    }
  }

  const { error: deleteError } = await adminSupabase
    .from("openclaw_instances")
    .delete()
    .eq("id", instanceRow.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
