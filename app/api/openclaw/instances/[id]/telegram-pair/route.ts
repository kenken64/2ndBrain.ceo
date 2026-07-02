import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { pairOpenClawTelegram } from "@/lib/openclaw";
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
  id: string;
  instance: string | null;
  provision_status: string;
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

export async function POST(request: Request, context: InstanceRouteContext) {
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

  const body = (await request.json().catch(() => ({}))) as { code?: unknown };
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!/^[A-Za-z0-9]{8}$/.test(code)) {
    return NextResponse.json({ error: "invalid_telegram_pair_code" }, { status: 400 });
  }

  const adminSupabase = createAdminClient();
  const { data: row, error: rowError } = await adminSupabase
    .from("openclaw_instances")
    .select("id,instance,provision_status")
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
  const instance = instanceRow.instance?.trim();

  if (instanceRow.provision_status !== "ready" || !instance) {
    return NextResponse.json({ error: "instance_not_ready" }, { status: 409 });
  }

  try {
    await pairOpenClawTelegram({ code, instance });

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "openclaw_telegram_pair_failed";

    console.error("[openclaw:instances] telegram pair failed", { instanceId: instanceRow.id });

    return NextResponse.json(
      { error: message.startsWith("missing_") ? message : "openclaw_telegram_pair_failed" },
      { status: 500 }
    );
  }
}
