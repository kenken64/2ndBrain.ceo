import { NextResponse } from "next/server";
import { authorizeGyneBridge } from "@/lib/gyne-bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ATTEMPTS_TABLE = "gyne_task_attempts";

function asTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalString(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";

  return text || null;
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

/**
 * Lists the durable attempt history for one kanban card, oldest attempt first.
 */
export async function GET(request: Request) {
  const auth = authorizeGyneBridge(request);

  if (!auth.ok) {
    return auth.response;
  }

  const cardId = new URL(request.url).searchParams.get("card_id")?.trim() ?? "";

  if (!cardId) {
    return NextResponse.json({ error: "card_id_required" }, { status: 400 });
  }

  const { adminSupabase, userId } = auth.context;
  const { data, error } = await adminSupabase
    .from(ATTEMPTS_TABLE)
    .select(
      "card_id,task_id,attempt,title,prompt,spec,done_when,output,verdict,human_action,human_feedback,consumer,created_at,updated_at"
    )
    .eq("user_id", userId)
    .eq("card_id", cardId)
    .order("attempt", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ attempts: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Upserts one attempt, idempotent on (user_id, task_id). The frontend fires this at several
 * moments in an attempt's life (publish, terminal update, human Approve/Reject), so only the
 * fields present in the body are written — later calls enrich the same row instead of blanking
 * fields recorded earlier.
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

  const cardId = asTrimmedString(body.card_id);
  const taskId = asTrimmedString(body.task_id);

  if (!cardId || !taskId) {
    return NextResponse.json({ error: "card_id_and_task_id_required" }, { status: 400 });
  }

  const { adminSupabase, userId } = auth.context;
  const row: Record<string, unknown> = {
    user_id: userId,
    card_id: cardId,
    task_id: taskId
  };

  if (typeof body.attempt === "number" && Number.isInteger(body.attempt) && body.attempt > 0) {
    row.attempt = body.attempt;
  }

  if (typeof body.title === "string") {
    row.title = body.title;
  }

  if (typeof body.prompt === "string") {
    row.prompt = body.prompt;
  }

  if (typeof body.spec === "string") {
    row.spec = body.spec;
  }

  if (body.done_when !== undefined) {
    row.done_when = asStringArray(body.done_when);
  }

  if (typeof body.output === "string") {
    row.output = body.output;
  }

  if (body.verdict !== undefined && typeof body.verdict === "object" && body.verdict !== null) {
    row.verdict = body.verdict;
  }

  const humanAction = asOptionalString(body.human_action);

  if (humanAction) {
    if (humanAction !== "approved" && humanAction !== "rejected") {
      return NextResponse.json({ error: "invalid_human_action" }, { status: 400 });
    }

    row.human_action = humanAction;
  }

  if (typeof body.human_feedback === "string") {
    row.human_feedback = body.human_feedback;
  }

  const consumer = asOptionalString(body.consumer);

  if (consumer) {
    row.consumer = consumer;
  }

  const { data: existing, error: readError } = await adminSupabase
    .from(ATTEMPTS_TABLE)
    .select("id")
    .eq("user_id", userId)
    .eq("task_id", taskId)
    .maybeSingle();

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  const { error: writeError } = existing
    ? await adminSupabase.from(ATTEMPTS_TABLE).update(row).eq("id", existing.id)
    : await adminSupabase.from(ATTEMPTS_TABLE).insert(row);

  if (writeError) {
    return NextResponse.json({ error: writeError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, created: !existing });
}
