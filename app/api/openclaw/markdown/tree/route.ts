import { NextResponse } from "next/server";
import { readOpenClawWikiTree } from "@/lib/openclaw";
import { getWikiContext, wikiApiError } from "@/lib/wiki-server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await getWikiContext();
    const tree = await readOpenClawWikiTree({
      instance: context.instance,
      projectSlug: null
    });

    return NextResponse.json({
      tree
    });
  } catch (error) {
    return wikiApiError(error);
  }
}
