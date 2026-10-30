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
    const payload = (await request.json().catch(() => null)) as { projectId?: unknown; prompt?: unknown } | null;
    const projectId = typeof payload?.projectId === "string" ? payload.projectId.trim() : "";
    const retryPrompt = typeof payload?.prompt === "string" ? payload.prompt.trim() : "";

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
      return NextResponse.json({ error: "AI Agent profile is incomplete" }, { status: 409 });
    }

    const { data: latestJob, error: latestJobError } = await context.supabase
      .from("wiki_sync_jobs")
      .select("id,status,error,file_path,created_at,started_at,completed_at")
      .eq("user_id", context.userId)
      .eq("project_id", projectId)
      .eq("job_type", "ingest")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestJobError) {
      return NextResponse.json({ error: latestJobError.message }, { status: 500 });
    }

    if (!latestJob?.id || (latestJob.status !== "failed" && latestJob.status !== "ready")) {
      return NextResponse.json({
        hidden: true,
        ok: true,
        message: "No saved upload needs retry."
      });
    }

    const previousStatus = latestJob.status;
    const { data: claimedJob, error: claimError } = await context.supabase
      .from("wiki_sync_jobs")
      .update({
        completed_at: null,
        error: null,
        started_at: new Date().toISOString(),
        status: "running"
      })
      .eq("id", latestJob.id)
      .eq("status", previousStatus)
      .select("id")
      .maybeSingle();

    if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
    if (!claimedJob) return NextResponse.json({ error: "This upload is already being processed." }, { status: 409 });

    try {
      const result = await backfillOpenClawWikiIngest({
        avatarName,
        instance: context.instance,
        ownerName,
        projectId,
        projectSlug: context.projectSlug,
        projectTitle: context.project.title,
        prompt: retryPrompt || (previousStatus === "ready" ? context.project.openclaw_generation_prompt : null) || context.project.prompt,
        sourceNamespace: latestJob.file_path,
        userId: context.userId
      });

      const { error: projectUpdateError } = await context.supabase
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

      if (projectUpdateError) throw new Error(projectUpdateError.message);

      await readOpenClawWikiTree({
        instance: context.instance,
        projectSlug: context.projectSlug
      });

      const { data: readyJob, error: completionError } = await context.supabase
        .from("wiki_sync_jobs")
        .update({
          completed_at: new Date().toISOString(),
          error: null,
          status: "ready"
        })
        .eq("id", latestJob.id)
        .select("id,status,error,created_at,started_at,completed_at")
        .maybeSingle();

      if (completionError || !readyJob) throw new Error(completionError?.message ?? "Could not update ingest status.");

      return NextResponse.json({
        hidden: true,
        job: readyJob,
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
        .eq("id", latestJob.id);

      return NextResponse.json({ error: outputSummary(message) }, { status: 500 });
    }
  } catch (error) {
    return wikiApiError(error);
  }
}
