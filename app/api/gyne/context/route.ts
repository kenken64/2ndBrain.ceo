import { NextResponse } from "next/server";
import { authorizeGyneBridge } from "@/lib/gyne-bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SearchRow = {
  title: string;
  file_path: string;
  snippet: string;
};

/**
 * Owner-scoped wiki full-text search for the Gyne publish path: `?q=<card title + prompt>`
 * returns the top-ranked pages as {title, file_path, snippet} so the frontend can inject them
 * into the outbound task prompt as cited reference context.
 */
export async function GET(request: Request) {
  const auth = authorizeGyneBridge(request);

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 10) : 3;

  if (!q) {
    return NextResponse.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const { adminSupabase, userId } = auth.context;
  const { data, error } = await adminSupabase.rpc("gyne_search_wiki", {
    p_user_id: userId,
    p_query: q,
    p_limit: limit
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = ((data ?? []) as SearchRow[]).map((row) => ({
    title: row.title,
    file_path: row.file_path,
    snippet: row.snippet
  }));

  return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
