import { NextResponse } from "next/server";
import { readOpenClawWikiPage, writeOpenClawWikiPage } from "@/lib/openclaw";
import { normalizeWikiPath, parseWikiMarkdown } from "@/lib/wiki";
import { getWikiContext, wikiApiError } from "@/lib/wiki-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filePath = normalizeWikiPath(url.searchParams.get("path") ?? "");
    const context = await getWikiContext();
    const page = await readOpenClawWikiPage({
      filePath,
      instance: context.instance,
      projectSlug: null
    });

    return NextResponse.json({
      graph: parseWikiMarkdown(page.content, page.filePath),
      page
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
    };
    const filePath = normalizeWikiPath(String(payload.path ?? ""));
    const context = await getWikiContext();
    const page = await writeOpenClawWikiPage({
      baseSha: payload.baseSha,
      content: String(payload.content ?? ""),
      filePath,
      instance: context.instance,
      projectSlug: null
    });

    return NextResponse.json({
      graph: parseWikiMarkdown(page.content, page.filePath),
      page
    });
  } catch (error) {
    return wikiApiError(error);
  }
}
