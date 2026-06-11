import { NextResponse, type NextRequest } from "next/server";
import { googleWorkspaceCodeLoginConfig } from "@/lib/google-workspace-auth";
import {
  getGoogleWorkspaceContext,
  googleWorkspaceApiError
} from "@/lib/google-workspace-context";
import { loginOpenClawGoogleWorkspaceWithCode } from "@/lib/openclaw";
import { appUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CompletePayload = {
  code?: unknown;
  state?: unknown;
};

function payloadString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  let response: NextResponse;

  try {
    const payload = (await request.json().catch(() => null)) as CompletePayload | null;
    const code = payloadString(payload?.code);
    const state = payloadString(payload?.state);
    const expectedState = request.cookies.get("gws_oauth_state")?.value ?? "";

    if (!code) {
      throw new Error("Google Workspace OAuth did not return a code.");
    }

    if (!state || !expectedState || state !== expectedState) {
      throw new Error("Google Workspace callback state did not match this browser session.");
    }

    const context = await getGoogleWorkspaceContext();
    const codeLogin = googleWorkspaceCodeLoginConfig(
      code,
      appUrl("/api/openclaw/gws-auth/callback", request).toString()
    );

    await loginOpenClawGoogleWorkspaceWithCode({
      clientId: codeLogin.clientId,
      clientSecret: codeLogin.clientSecret,
      code: codeLogin.code,
      filename: "credentials.json",
      instance: context.instance,
      redirectUri: codeLogin.redirectUri
    });

    const { error: connectedError } = await context.supabase
      .from("profiles")
      .update({ google_workspace_connected_at: new Date().toISOString() })
      .eq("id", context.userId);

    if (connectedError) {
      console.error(
        "[openclaw:gws-complete] connected_at update failed",
        JSON.stringify({ error: connectedError.message, userId: context.userId })
      );
    }

    console.info(
      "[openclaw:gws-complete] complete",
      JSON.stringify({
        source: "oauth_code_handoff",
        userId: context.userId
      })
    );

    response = NextResponse.json({
      message: "OpenClaw received the Google Workspace credentials.",
      ok: true,
      status: "connected"
    });
  } catch (error) {
    response = googleWorkspaceApiError(error);
  }

  response.cookies.delete("gws_oauth_state");

  return response;
}
