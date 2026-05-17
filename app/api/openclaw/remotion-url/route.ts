import { NextResponse } from "next/server";
import { setupOpenClawAvatar } from "@/lib/openclaw";
import { getWikiContext, wikiApiError } from "@/lib/wiki-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

function outputSummary(value: string) {
  return value.slice(-4000);
}

async function isReachableUrl(value: string) {
  try {
    const head = await fetch(value, {
      cache: "no-store",
      method: "HEAD",
      signal: AbortSignal.timeout(8000)
    });

    if (head.ok) {
      return true;
    }

    if (head.status !== 405) {
      return false;
    }

    const get = await fetch(value, {
      cache: "no-store",
      method: "GET",
      signal: AbortSignal.timeout(8000)
    });

    return get.ok;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const context = await getWikiContext(null, { selectLatest: false });
    const storedRemotionUrl = context.profile.openclaw_remotion_url?.trim() ?? "";

    if (storedRemotionUrl && !forceRefresh && (await isReachableUrl(storedRemotionUrl))) {
      return NextResponse.json({
        remotionUrl: storedRemotionUrl,
        source: "stored",
        status: "ready"
      });
    }

    const avatarGender = context.profile.avatar_gender?.trim();
    const avatarGlbPath = context.profile.avatar_glb_path?.trim();
    const avatarName = context.profile.avatar_name?.trim();

    if (!avatarGender || !avatarGlbPath || !avatarName) {
      return NextResponse.json({
        error: "Remotion avatar profile is incomplete",
        remotionUrl: storedRemotionUrl || null,
        status: storedRemotionUrl ? "stale" : "pending"
      });
    }

    try {
      const avatarSetup = await setupOpenClawAvatar({
        avatarGender,
        avatarGlbPath,
        avatarName,
        instance: context.instance
      });
      const nextRemotionUrl = avatarSetup.remotionUrl?.trim() ?? "";

      if (!nextRemotionUrl) {
        return NextResponse.json({
          error: "Remotion setup completed without a public URL",
          remotionUrl: storedRemotionUrl || null,
          status: storedRemotionUrl ? "stale" : "pending"
        });
      }

      const completedAt = new Date().toISOString();
      const { error } = await context.supabase
        .from("profiles")
        .update({
          openclaw_remotion_completed_at: completedAt,
          openclaw_remotion_output: outputSummary(avatarSetup.remotionOutput),
          openclaw_remotion_url: nextRemotionUrl
        })
        .eq("id", context.userId);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        remotionUrl: nextRemotionUrl,
        source: forceRefresh ? "forced-refresh" : "refreshed",
        status: "ready"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "openclaw_remotion_url_refresh_failed";

      return NextResponse.json({
        error: outputSummary(message),
        remotionUrl: storedRemotionUrl || null,
        status: storedRemotionUrl ? "stale" : "pending"
      });
    }
  } catch (error) {
    return wikiApiError(error);
  }
}
