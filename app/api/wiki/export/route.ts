import { NextResponse } from "next/server";
import { exportOpenClawWiki } from "@/lib/openclaw";
import { getWikiContext, wikiApiError } from "@/lib/wiki-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const context = await getWikiContext(url.searchParams.get("projectId"));

    if (!context.projectSlug) {
      return NextResponse.json({ error: "LLM Wiki has not been generated yet" }, { status: 409 });
    }

    const exported = await exportOpenClawWiki({
      instance: context.instance,
      projectSlug: context.projectSlug
    });

    return NextResponse.json({
      export: exported,
      project: context.project
    });
  } catch (error) {
    return wikiApiError(error);
  }
}
