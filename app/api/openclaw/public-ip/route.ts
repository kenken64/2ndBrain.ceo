import { NextResponse } from "next/server";
import { getOpenClawPublicIp } from "@/lib/openclaw";
import { getWikiContext, wikiApiError } from "@/lib/wiki-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await getWikiContext(null, { selectLatest: false });
    const resolved = await getOpenClawPublicIp({
      instance: context.instance
    });

    return NextResponse.json({
      publicIp: resolved.publicIp,
      source: resolved.source,
      status: resolved.publicIp ? "ready" : "pending"
    });
  } catch (error) {
    return wikiApiError(error);
  }
}
