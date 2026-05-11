import { NextResponse } from "next/server";
import { readOpenClawWikiTree } from "@/lib/openclaw";
import { getWikiContext, wikiApiError } from "@/lib/wiki-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const context = await getWikiContext(url.searchParams.get("projectId"));

    if (!context.projectSlug) {
      return NextResponse.json({ error: "LLM Wiki has not been generated yet" }, { status: 409 });
    }

    const tree = await readOpenClawWikiTree({
      instance: context.instance,
      projectSlug: context.projectSlug
    });

    return NextResponse.json({
      project: context.project,
      tree
    });
  } catch (error) {
    return wikiApiError(error);
  }
}
