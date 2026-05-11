import { NextResponse } from "next/server";
import { readOpenClawWikiPage, readOpenClawWikiTree } from "@/lib/openclaw";
import { syncWikiPageGraph } from "@/lib/wiki-index";
import { normalizeWikiPath, parseWikiMarkdown, type WikiTreeItem } from "@/lib/wiki";
import { getWikiContext, wikiApiError } from "@/lib/wiki-server";

export const runtime = "nodejs";

function flattenMarkdownFiles(items: WikiTreeItem[]) {
  const files: WikiTreeItem[] = [];

  function walk(nodes: WikiTreeItem[]) {
    for (const node of nodes) {
      if (node.type === "file") {
        files.push(node);
      }

      if (node.children) {
        walk(node.children);
      }
    }
  }

  walk(items);

  return files;
}

function outputSummary(value: string) {
  return value.slice(-4000);
}

export async function POST(request: Request) {
  let jobId: string | null = null;

  try {
    const payload = (await request.json()) as {
      scope?: "page" | "project";
      path?: string;
      projectId?: string | null;
    };
    const requestedProjectId = typeof payload.projectId === "string" ? payload.projectId : "";

    if (!requestedProjectId) {
      return NextResponse.json({ error: "project_id_required" }, { status: 400 });
    }

    const context = await getWikiContext(requestedProjectId, { selectLatest: false });

    if (!context.project?.id || !context.projectSlug) {
      return NextResponse.json({ error: "LLM Wiki has not been generated yet" }, { status: 409 });
    }

    if (payload.scope === "project") {
      const { data: job } = await context.supabase
        .from("wiki_sync_jobs")
        .insert({
          job_type: "project_sync",
          project_id: context.project?.id ?? null,
          started_at: new Date().toISOString(),
          status: "running",
          user_id: context.userId
        })
        .select("id")
        .single();
      jobId = job?.id ?? null;

      const tree = await readOpenClawWikiTree({
        instance: context.instance,
        projectSlug: context.projectSlug
      });
      const files = flattenMarkdownFiles(tree);
      let edgeCount = 0;
      let nodeCount = 0;
      const pages: Array<{ edgeCount: number; filePath: string; nodeCount: number; pageId: string }> = [];

      for (const file of files) {
        const page = await readOpenClawWikiPage({
          filePath: file.path,
          instance: context.instance,
          projectSlug: context.projectSlug
        });
        const graph = parseWikiMarkdown(page.content, page.filePath);
        const sync = await syncWikiPageGraph({
          page,
          parsed: graph,
          projectId: context.project.id,
          supabase: context.supabase,
          userId: context.userId
        });

        edgeCount += sync.edgeCount;
        nodeCount += sync.nodeCount;
        pages.push({
          edgeCount: sync.edgeCount,
          filePath: page.filePath,
          nodeCount: sync.nodeCount,
          pageId: sync.pageId
        });
      }

      if (jobId) {
        await context.supabase
          .from("wiki_sync_jobs")
          .update({
            completed_at: new Date().toISOString(),
            status: "ready"
          })
          .eq("id", jobId);
      }

      return NextResponse.json({
        project: context.project,
        sync: {
          edgeCount,
          nodeCount,
          pageCount: pages.length,
          pages
        }
      });
    }

    const filePath = normalizeWikiPath(String(payload.path ?? ""));
    const { data: job } = await context.supabase
      .from("wiki_sync_jobs")
      .insert({
        file_path: filePath,
        job_type: "page_sync",
        project_id: context.project?.id ?? null,
        started_at: new Date().toISOString(),
        status: "running",
        user_id: context.userId
      })
      .select("id")
      .single();
    jobId = job?.id ?? null;

    const page = await readOpenClawWikiPage({
      filePath,
      instance: context.instance,
      projectSlug: context.projectSlug
    });
    const graph = parseWikiMarkdown(page.content, page.filePath);
    const sync = await syncWikiPageGraph({
      page,
      parsed: graph,
      projectId: context.project.id,
      supabase: context.supabase,
      userId: context.userId
    });

    if (job?.id) {
      await context.supabase
        .from("wiki_sync_jobs")
        .update({
          completed_at: new Date().toISOString(),
          status: "ready"
        })
        .eq("id", job.id);
    }

    return NextResponse.json({
      graph,
      page,
      project: context.project,
      sync
    });
  } catch (error) {
    if (jobId) {
      try {
        const context = await getWikiContext(null, { selectLatest: false });

        await context.supabase
          .from("wiki_sync_jobs")
          .update({
            completed_at: new Date().toISOString(),
            error: outputSummary(error instanceof Error ? error.message : "wiki_sync_failed"),
            status: "failed"
          })
          .eq("id", jobId);
      } catch {
        // Preserve the original error response.
      }
    }

    return wikiApiError(error);
  }
}
