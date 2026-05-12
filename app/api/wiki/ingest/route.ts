import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ingestOpenClawWikiAttachments, readOpenClawWikiTree } from "@/lib/openclaw";
import { getWikiContext, wikiApiError } from "@/lib/wiki-server";
import { convertWikiAttachments } from "@/lib/wiki-attachments";

export const runtime = "nodejs";

function outputSummary(value: string) {
  return value.slice(-4000);
}

function uploadNamespace() {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  return `raw/uploads/${stamp}-${randomUUID().slice(0, 8)}`;
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
      return NextResponse.json({ error: "LLM Wiki has not been generated yet" }, { status: 409 });
    }

    if (context.project.status !== "ready") {
      return NextResponse.json({ error: "LLM Wiki is not ready for document upload" }, { status: 409 });
    }

    const namespace = uploadNamespace();
    let attachments: Awaited<ReturnType<typeof convertWikiAttachments>> = [];

    try {
      attachments = await convertWikiAttachments(formData.getAll("attachments"), {
        assetRoot: `${namespace}/assets`,
        sourceRoot: `${namespace}/sources`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "attachment_conversion_failed";

      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (attachments.length === 0) {
      return NextResponse.json({ error: "attachments_required" }, { status: 400 });
    }

    const avatarName = context.profile.avatar_name?.trim();
    const ownerName = context.profile.owner_name?.trim();

    if (!avatarName || !ownerName) {
      return NextResponse.json({ error: "OpenClaw profile is incomplete" }, { status: 409 });
    }

    const ingested = await ingestOpenClawWikiAttachments({
      attachments,
      avatarName,
      instance: context.instance,
      ownerName,
      projectId: context.project.id,
      projectSlug: context.projectSlug,
      projectTitle: context.project.title,
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
      .eq("id", context.project.id);

    const tree = await readOpenClawWikiTree({
      instance: context.instance,
      projectSlug: context.projectSlug
    });

    return NextResponse.json({
      attachments: attachments.map((attachment) => ({
        fileName: attachment.fileName,
        path: attachment.path,
        sourceType: attachment.sourceType
      })),
      project: context.project,
      tree
    });
  } catch (error) {
    return wikiApiError(error);
  }
}
