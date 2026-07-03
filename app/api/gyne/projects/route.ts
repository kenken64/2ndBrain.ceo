import { NextResponse } from "next/server";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProjectRow = {
  id: string;
  title: string;
};

function cleanEnvValue(value: string | undefined) {
  const cleaned = value?.trim().replace(/^['"]|['"]$/g, "");

  return cleaned || null;
}

function configuredBridgeSecret() {
  return cleanEnvValue(process.env.GYNE_BRAIN_API_SECRET);
}

function requestBridgeSecret(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";

  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
}

/**
 * Server-to-server bridge for the Gyne Agent publisher: lists the launching user's projects so
 * the kanban can keep one board per project. The publisher authenticates the browser via its
 * launch session and forwards the user_id here with the shared bridge secret.
 */
export async function GET(request: Request) {
  const secret = configuredBridgeSecret();

  if (!secret) {
    return NextResponse.json({ error: "GYNE_BRAIN_API_SECRET is not configured" }, { status: 503 });
  }

  if (requestBridgeSecret(request) !== secret) {
    return NextResponse.json({ error: "Invalid gyne bridge secret" }, { status: 401 });
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for the gyne bridge" },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const userId = url.searchParams.get("user_id")?.trim() ?? "";

  if (!userId) {
    return NextResponse.json({ error: "user_id_required" }, { status: 400 });
  }

  const adminSupabase = createAdminClient();
  const { data, error } = await adminSupabase
    .from("projects")
    .select("id,title")
    .eq("user_id", userId)
    .neq("status", "archived")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const projects = ((data ?? []) as ProjectRow[]).map((row) => ({
    id: row.id,
    name: row.title
  }));

  return NextResponse.json({ projects }, { headers: { "Cache-Control": "no-store" } });
}
