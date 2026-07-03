import { NextResponse } from "next/server";
import { authorizeGyneBridge } from "@/lib/gyne-bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EVALS_TABLE = "gyne_evals";
const EVAL_COLUMNS =
  "id,criterion,rationale,match_tags,match_keywords,source_card_id,source_task_id,active,created_at,updated_at";

function asOptionalString(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";

  return text || null;
}

function asKeywordArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

/**
 * Lists the user's evals — reusable acceptance criteria promoted from past attempts.
 * `?active=true|false` filters by status; omitting it returns everything.
 */
export async function GET(request: Request) {
  const auth = authorizeGyneBridge(request);

  if (!auth.ok) {
    return auth.response;
  }

  const activeParam = new URL(request.url).searchParams.get("active");
  const { adminSupabase, userId } = auth.context;
  let query = adminSupabase
    .from(EVALS_TABLE)
    .select(EVAL_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (activeParam === "true" || activeParam === "false") {
    query = query.eq("active", activeParam === "true");
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ evals: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Creates one eval, typically via the frontend's "Promote to eval" action on a failed
 * criterion or rejected attempt.
 */
export async function POST(request: Request) {
  const auth = authorizeGyneBridge(request);

  if (!auth.ok) {
    return auth.response;
  }

  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const criterion = asOptionalString(body.criterion);

  if (!criterion) {
    return NextResponse.json({ error: "criterion_required" }, { status: 400 });
  }

  const { adminSupabase, userId } = auth.context;
  const { data, error } = await adminSupabase
    .from(EVALS_TABLE)
    .insert({
      user_id: userId,
      criterion,
      rationale: asOptionalString(body.rationale),
      match_tags: asKeywordArray(body.match_tags),
      match_keywords: asKeywordArray(body.match_keywords),
      source_card_id: asOptionalString(body.source_card_id),
      source_task_id: asOptionalString(body.source_task_id)
    })
    .select(EVAL_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ eval: data }, { status: 201 });
}

/**
 * Updates one eval (owner-scoped): deactivate/reactivate, or edit criterion and matchers.
 */
export async function PATCH(request: Request) {
  const auth = authorizeGyneBridge(request);

  if (!auth.ok) {
    return auth.response;
  }

  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const id = asOptionalString(body.id);

  if (!id) {
    return NextResponse.json({ error: "id_required" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (typeof body.active === "boolean") {
    patch.active = body.active;
  }

  const criterion = asOptionalString(body.criterion);

  if (criterion) {
    patch.criterion = criterion;
  }

  if (typeof body.rationale === "string") {
    patch.rationale = asOptionalString(body.rationale);
  }

  if (body.match_tags !== undefined) {
    patch.match_tags = asKeywordArray(body.match_tags);
  }

  if (body.match_keywords !== undefined) {
    patch.match_keywords = asKeywordArray(body.match_keywords);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no_fields_to_update" }, { status: 400 });
  }

  const { adminSupabase, userId } = auth.context;
  const { data, error } = await adminSupabase
    .from(EVALS_TABLE)
    .update(patch)
    .eq("user_id", userId)
    .eq("id", id)
    .select(EVAL_COLUMNS)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "eval_not_found" }, { status: 404 });
  }

  return NextResponse.json({ eval: data });
}
