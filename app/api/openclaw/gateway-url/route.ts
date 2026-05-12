import { NextResponse } from "next/server";
import { getOpenClawGatewayUrl } from "@/lib/openclaw";
import { getWikiContext, wikiApiError } from "@/lib/wiki-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function outputSummary(value: string) {
  return value.slice(-4000);
}

export async function GET() {
  try {
    const context = await getWikiContext(null, { selectLatest: false });
    const storedGatewayUrl = context.profile.openclaw_gateway_url?.trim();

    if (storedGatewayUrl) {
      return NextResponse.json({
        gatewayUrl: storedGatewayUrl,
        status: "ready"
      });
    }

    try {
      const gateway = await getOpenClawGatewayUrl({
        instance: context.instance
      });

      if (!gateway.gatewayUrl) {
        return NextResponse.json({
          gatewayUrl: null,
          status: "pending"
        });
      }

      const completedAt = new Date().toISOString();
      const { error } = await context.supabase
        .from("profiles")
        .update({
          openclaw_gateway_completed_at: completedAt,
          openclaw_gateway_output: outputSummary(gateway.gatewayOutput),
          openclaw_gateway_url: gateway.gatewayUrl
        })
        .eq("id", context.userId);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        gatewayUrl: gateway.gatewayUrl,
        status: "ready"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "openclaw_gateway_url_pending";

      return NextResponse.json({
        error: message,
        gatewayUrl: null,
        status: "pending"
      });
    }
  } catch (error) {
    return wikiApiError(error);
  }
}
