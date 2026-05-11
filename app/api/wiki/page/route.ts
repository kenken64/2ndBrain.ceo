import { NextResponse } from "next/server";
import { readOpenClawWikiPage, writeOpenClawWikiPage } from "@/lib/openclaw";
import { syncWikiPageGraph } from "@/lib/wiki-index";
import { normalizeWikiPath, parseWikiMarkdown } from "@/lib/wiki";
import { getWikiContext, wikiApiError } from "@/lib/wiki-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filePath = normalizeWikiPath(url.searchParams.get("path") ?? "");
    const context = await getWikiContext(url.searchParams.get("projectId"));

    if (!context.projectSlug) {
      return NextResponse.json({ error: "LLM Wiki has not been generated yet" }, { status: 409 });
    }

    const page = await readOpenClawWikiPage({
      filePath,
      instance: context.instance,
      projectSlug: context.projectSlug
    });
    const graph = parseWikiMarkdown(page.content, page.filePath);

    return NextResponse.json({
      graph,
      page,
      project: context.project
    });
  } catch (error) {
    return wikiApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      baseSha?: string | null;
      content?: string;
      path?: string;
      projectId?: string | null;
    };
    const filePath = normalizeWikiPath(String(payload.path ?? ""));
    const content = String(payload.content ?? "");
    const context = await getWikiContext(payload.projectId);

    if (!context.projectSlug) {
      return NextResponse.json({ error: "LLM Wiki has not been generated yet" }, { status: 409 });
    }

    const page = await writeOpenClawWikiPage({
      baseSha: payload.baseSha,
      content,
      filePath,
      instance: context.instance,
      projectSlug: context.projectSlug
    });
    const graph = parseWikiMarkdown(page.content, page.filePath);
    const sync = await syncWikiPageGraph({
      page,
      parsed: graph,
      projectId: context.project?.id ?? null,
      supabase: context.supabase,
      userId: context.userId
    });

    await context.supabase.from("wiki_revisions").insert({
      base_sha: payload.baseSha ?? null,
      change_source: "user",
      file_path: page.filePath,
      next_sha: page.sha ?? null,
      page_id: sync.pageId,
      project_id: context.project?.id ?? null,
      user_id: context.userId
    });

    return NextResponse.json({
      graph,
      page,
      project: context.project,
      sync
    });
  } catch (error) {
    return wikiApiError(error);
  }
}
