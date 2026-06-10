import { NextResponse, type NextRequest } from "next/server";
import {
  exchangeGoogleWorkspaceCodeForCredentials,
  extractGoogleWorkspaceCode,
  normalizeGoogleWorkspaceCredentials
} from "@/lib/google-workspace-auth";
import {
  getGoogleWorkspaceContext,
  googleWorkspaceApiError
} from "@/lib/google-workspace-context";
import { loginOpenClawGoogleWorkspace } from "@/lib/openclaw";
import { appUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GoogleWorkspaceLoginPayload = {
  authorizationCode?: unknown;
  callbackUrl?: unknown;
  credentialsJson?: unknown;
  filename?: unknown;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function credentialsFilename(value: unknown) {
  const filename = stringValue(value);

  return filename || "credentials.json";
}

async function credentialsFromPayload(
  payload: GoogleWorkspaceLoginPayload,
  expectedState: string | null,
  redirectUri: string
) {
  if ("credentialsJson" in payload && payload.credentialsJson !== undefined) {
    return {
      credentialsJson: normalizeGoogleWorkspaceCredentials(payload.credentialsJson),
      source: "credentials_json"
    };
  }

  const callbackInput =
    stringValue(payload.callbackUrl) || stringValue(payload.authorizationCode);
  const { code, state } = extractGoogleWorkspaceCode(callbackInput);

  if (!code) {
    throw new Error("Paste the Google localhost callback URL, authorization code, or exported credentials JSON.");
  }

  if (expectedState && state && state !== expectedState) {
    throw new Error("Google Workspace callback state did not match this browser session.");
  }

  return {
    credentialsJson: await exchangeGoogleWorkspaceCodeForCredentials(code, redirectUri),
    source: "oauth_code"
  };
}

export async function POST(request: NextRequest) {
  let payload: GoogleWorkspaceLoginPayload;

  try {
    payload = (await request.json()) as GoogleWorkspaceLoginPayload;
  } catch {
    return NextResponse.json({ error: "Invalid Google Workspace auth payload." }, { status: 400 });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Invalid Google Workspace auth payload." }, { status: 400 });
  }

  try {
    const context = await getGoogleWorkspaceContext();
    const expectedState = request.cookies.get("gws_oauth_state")?.value ?? null;
    const credentials = await credentialsFromPayload(
      payload,
      expectedState,
      appUrl("/api/openclaw/gws-auth/callback", request).toString()
    );
    const result = await loginOpenClawGoogleWorkspace({
      credentialsJson: credentials.credentialsJson,
      filename: credentialsFilename(payload.filename),
      instance: context.instance
    });

    console.info(
      "[openclaw:gws-login] complete",
      JSON.stringify({
        source: credentials.source,
        userId: context.userId
      })
    );

    const response = NextResponse.json({
      ok: true,
      output: result.output,
      source: credentials.source,
      status: "connected"
    });

    response.cookies.delete("gws_oauth_state");

    return response;
  } catch (error) {
    return googleWorkspaceApiError(error);
  }
}
