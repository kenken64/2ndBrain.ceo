import { NextResponse } from "next/server";
import { authorizeGyneBridge } from "@/lib/gyne-bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type EvalRow = {
  id: string;
  criterion: string;
  rationale: string | null;
  match_tags: string[];
  match_keywords: string[];
};

function parseTags(value: string | null) {
  return (value ?? "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns the user's active evals that match a card being published: by tag overlap with
 * `?tags=a,b`, or by any match keyword appearing in `?q=` (the card's title + prompt).
 * The frontend merges the returned criteria into the card's effective done-when list.
 */
export async function GET(request: Request) {
  const auth = authorizeGyneBridge(request);

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);
  const tags = parseTags(url.searchParams.get("tags"));
  const q = (url.searchParams.get("q") ?? "").toLowerCase();

  if (tags.length === 0 && !q.trim()) {
    return NextResponse.json({ evals: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const { adminSupabase, userId } = auth.context;
  const { data, error } = await adminSupabase
    .from("gyne_evals")
    .select("id,criterion,rationale,match_tags,match_keywords")
    .eq("user_id", userId)
    .eq("active", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const matched = ((data ?? []) as EvalRow[]).filter((row) => {
    const rowTags = (row.match_tags ?? []).map((tag) => tag.toLowerCase());

    if (tags.length > 0 && rowTags.some((tag) => tags.includes(tag))) {
      return true;
    }

    return (row.match_keywords ?? []).some(
      (keyword) => keyword.trim() && q.includes(keyword.trim().toLowerCase())
    );
  });

  return NextResponse.json({ evals: matched }, { headers: { "Cache-Control": "no-store" } });
}
