import { NextResponse } from "next/server";
import { backfillOpenClawWikiIngest, readOpenClawWikiTree } from "@/lib/openclaw";
import { getWikiContext, wikiApiError } from "@/lib/wiki-server";

export const runtime = "nodejs";
export const maxDuration = 900;

function outputSummary(value: string) {
  return value.slice(-4000);
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as { projectId?: unknown } | null;
    const projectId = typeof payload?.projectId === "string" ? payload.projectId.trim() : "";

    if (!projectId) {
      return NextResponse.json({ error: "project_id_required" }, { status: 400 });
    }

    const context = await getWikiContext(projectId, { selectLatest: false });

    if (!context.project || !context.projectSlug) {
      return NextResponse.json({ error: "Nth Brain has not been generated yet" }, { status: 409 });
    }

    if (context.project.status !== "ready") {
      return NextResponse.json({ error: "Nth Brain is not ready for backfill" }, { status: 409 });
    }

    const avatarName = context.profile.avatar_name?.trim();
    const ownerName = context.profile.owner_name?.trim();

    if (!avatarName || !ownerName) {
      return NextResponse.json({ error: "OpenClaw profile is incomplete" }, { status: 409 });
    }

    const { data: failedJob, error: failedJobError } = await context.supabase
      .from("wiki_sync_jobs")
      .select("id,status,error,created_at,started_at,completed_at")
      .eq("user_id", context.userId)
      .eq("project_id", projectId)
      .eq("job_type", "ingest")
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (failedJobError) {
      return NextResponse.json({ error: failedJobError.message }, { status: 500 });
    }

    if (!failedJob?.id) {
      await context.supabase
        .from("projects")
        .update({
          openclaw_generation_error: null
        })
        .eq("id", projectId);

      return NextResponse.json({
        hidden: true,
        ok: true,
        message: "No failed ingest job needs backfill."
      });
    }

    await context.supabase
      .from("wiki_sync_jobs")
      .update({
        error: null,
        started_at: new Date().toISOString(),
        status: "running"
      })
      .eq("id", failedJob.id);

    try {
      const result = await backfillOpenClawWikiIngest({
        avatarName,
        instance: context.instance,
        ownerName,
        projectId,
        projectSlug: context.projectSlug,
        projectTitle: context.project.title,
        prompt: context.project.prompt,
        userId: context.userId
      });

      await context.supabase
        .from("projects")
        .update({
          openclaw_generation_completed_at: new Date().toISOString(),
          openclaw_generation_error: null,
          openclaw_generation_mapping: result.mapping,
          openclaw_generation_output: outputSummary(
            [result.attachmentsOutput, result.output].filter(Boolean).join("\n\n")
          ),
          openclaw_generation_prompt: result.task
        })
        .eq("id", projectId);

      await readOpenClawWikiTree({
        instance: context.instance,
        projectSlug: context.projectSlug
      });

      const { data: readyJob } = await context.supabase
        .from("wiki_sync_jobs")
        .update({
          completed_at: new Date().toISOString(),
          error: null,
          status: "ready"
        })
        .eq("id", failedJob.id)
        .select("id,status,error,created_at,started_at,completed_at")
        .maybeSingle();

      return NextResponse.json({
        hidden: true,
        job: readyJob ?? failedJob,
        ok: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "wiki_ingest_backfill_failed";

      await context.supabase
        .from("wiki_sync_jobs")
        .update({
          completed_at: new Date().toISOString(),
          error: outputSummary(message),
          status: "failed"
        })
        .eq("id", failedJob.id);

      return NextResponse.json({ error: outputSummary(message) }, { status: 500 });
    }
  } catch (error) {
    return wikiApiError(error);
  }
}
