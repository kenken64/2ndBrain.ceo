import { NextResponse } from "next/server";
import { getOpenClawClaudeAuthStatus } from "@/lib/openclaw";
import { getWikiContext, wikiApiError } from "@/lib/wiki-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const context = await getWikiContext(null, { selectLatest: false });
    const result = await getOpenClawClaudeAuthStatus({
      instance: context.instance
    });

    return NextResponse.json(result);
  } catch (error) {
    return wikiApiError(error);
  }
}
