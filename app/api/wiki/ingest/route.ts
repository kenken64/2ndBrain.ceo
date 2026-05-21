import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { ingestOpenClawWikiAttachments, readOpenClawWikiTree } from "@/lib/openclaw";
import { getWikiContext, wikiApiError } from "@/lib/wiki-server";
import { convertWikiAttachments } from "@/lib/wiki-attachments";

export const runtime = "nodejs";
export const maxDuration = 900;

function outputSummary(value: string) {
  return value.slice(-4000);
}

function uploadNamespace() {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  return `raw/uploads/${stamp}-${randomUUID().slice(0, 8)}`;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId")?.trim() ?? "";

    if (!projectId) {
      return NextResponse.json({ error: "project_id_required" }, { status: 400 });
    }

    const context = await getWikiContext(projectId, { selectLatest: false });
    const { data, error } = await context.supabase
      .from("wiki_sync_jobs")
      .select("id,status,error,created_at,started_at,completed_at")
      .eq("user_id", context.userId)
      .eq("project_id", projectId)
      .eq("job_type", "ingest")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ job: data ?? null });
  } catch (error) {
    return wikiApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const projectId = String(formData.get("projectId") ?? "").trim();
    const prompt = String(formData.get("prompt") ?? "").trim();

    if (!projectId) {
      return NextResponse.json({ error: "project_id_required" }, { status: 400 });
    }

    const context = await getWikiContext(projectId, { selectLatest: false });

    if (!context.project || !context.projectSlug) {
      return NextResponse.json({ error: "Nth Brain has not been generated yet" }, { status: 409 });
    }

    if (context.project.status !== "ready") {
      return NextResponse.json({ error: "Nth Brain is not ready for document upload" }, { status: 409 });
    }

    const project = context.project;
    const projectSlug = context.projectSlug;

    const files = formData.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0);

    if (files.length === 0) {
      return NextResponse.json({ error: "attachments_required" }, { status: 400 });
    }

    const avatarName = context.profile.avatar_name?.trim();
    const ownerName = context.profile.owner_name?.trim();

    if (!avatarName || !ownerName) {
      return NextResponse.json({ error: "OpenClaw profile is incomplete" }, { status: 409 });
    }

    const { data: job, error: jobError } = await context.supabase
      .from("wiki_sync_jobs")
      .insert({
        job_type: "ingest",
        project_id: project.id,
        started_at: new Date().toISOString(),
        status: "queued",
        user_id: context.userId
      })
      .select("id,status,created_at,started_at,completed_at,error")
      .single();

    if (jobError || !job?.id) {
      return NextResponse.json({ error: jobError?.message ?? "ingest_job_create_failed" }, { status: 500 });
    }

    const namespace = uploadNamespace();

    after(async () => {
      try {
        await context.supabase
          .from("wiki_sync_jobs")
          .update({
            started_at: new Date().toISOString(),
            status: "running"
          })
          .eq("id", job.id);

        const attachments = await convertWikiAttachments(files, {
          assetRoot: `${namespace}/assets`,
          sourceRoot: `${namespace}/sources`
        });

        if (attachments.length === 0) {
          throw new Error("attachments_required");
        }

        const ingested = await ingestOpenClawWikiAttachments({
          attachments,
          avatarName,
          instance: context.instance,
          ownerName,
          projectId: project.id,
          projectSlug,
          projectTitle: project.title,
          prompt,
          userId: context.userId
        });

        await context.supabase
          .from("projects")
          .update({
            openclaw_generation_completed_at: new Date().toISOString(),
            openclaw_generation_error: null,
            openclaw_generation_mapping: ingested.mapping,
            openclaw_generation_output: outputSummary(
              [ingested.attachmentsOutput, ingested.output].filter(Boolean).join("\n\n")
            ),
            openclaw_generation_prompt: ingested.task
          })
          .eq("id", project.id);

        await readOpenClawWikiTree({
          instance: context.instance,
          projectSlug
        });

        await context.supabase
          .from("wiki_sync_jobs")
          .update({
            completed_at: new Date().toISOString(),
            error: null,
            status: "ready"
          })
          .eq("id", job.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "wiki_ingest_failed";

        await context.supabase
          .from("wiki_sync_jobs")
          .update({
            completed_at: new Date().toISOString(),
            error: outputSummary(message),
            status: "failed"
          })
          .eq("id", job.id);
      }
    });

    return NextResponse.json(
      {
        acceptedFiles: files.map((file) => ({
          fileName: file.name,
          size: file.size,
          type: file.type || "application/octet-stream"
        })),
        job,
        project
      },
      { status: 202 }
    );
  } catch (error) {
    return wikiApiError(error);
  }
}
