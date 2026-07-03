import { NextResponse } from "next/server";
import { authorizeGyneBridge } from "@/lib/gyne-bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProjectRow = {
  id: string;
  title: string;
};

/**
 * Server-to-server bridge for the Gyne Agent publisher: lists the launching user's projects so
 * the kanban can keep one board per project. The publisher authenticates the browser via its
 * launch session and forwards the user_id here with the shared bridge secret.
 */
export async function GET(request: Request) {
  const auth = authorizeGyneBridge(request);

  if (!auth.ok) {
    return auth.response;
  }

  const { adminSupabase, userId } = auth.context;
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
