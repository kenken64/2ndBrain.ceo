import { NextResponse, type NextRequest } from "next/server";
import { exchangeGoogleWorkspaceCodeForCredentials } from "@/lib/google-workspace-auth";
import {
  getGoogleWorkspaceContext,
  googleWorkspaceApiError
} from "@/lib/google-workspace-context";
import { loginOpenClawGoogleWorkspace } from "@/lib/openclaw";
import { appUrl, getRequestOrigin } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function scriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function popupResponse(request: NextRequest, payload: Record<string, string>) {
  const origin = getRequestOrigin(request);
  const settingsUrl = appUrl("/dashboard/settings?tab=integrations", request).toString();

  return new NextResponse(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Google Workspace Auth</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f5f8fb;
        color: #111827;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(420px, calc(100vw - 32px));
        border: 1px solid rgba(17, 24, 39, 0.12);
        border-radius: 12px;
        background: white;
        box-shadow: 0 24px 70px rgba(17, 24, 39, 0.14);
        padding: 24px;
      }
      h1 {
        margin: 0 0 10px;
        font-size: 20px;
      }
      p {
        margin: 0;
        color: #4b5563;
        line-height: 1.5;
      }
      a {
        display: inline-flex;
        margin-top: 18px;
        color: #005f9e;
        font-weight: 800;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${payload.status === "connected" ? "Google Workspace connected" : "Google Workspace auth failed"}</h1>
      <p>${payload.message}</p>
      <a href="${settingsUrl}">Return to settings</a>
    </main>
    <script>
      const payload = ${scriptJson(payload)};
      try {
        const channel = new BroadcastChannel("2ndbrain:gws-auth");
        channel.postMessage(payload);
        channel.close();
      } catch {}
      try {
        window.opener?.postMessage(payload, ${scriptJson(origin)});
      } catch {}
      if (payload.status === "connected") {
        window.setTimeout(() => window.close(), 900);
      }
    </script>
  </body>
</html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8"
      }
    }
  );
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const oauthError = requestUrl.searchParams.get("error")?.trim();
  const errorDescription = requestUrl.searchParams.get("error_description")?.trim();
  const code = requestUrl.searchParams.get("code")?.trim();
  const state = requestUrl.searchParams.get("state")?.trim() ?? "";
  const expectedState = request.cookies.get("gws_oauth_state")?.value ?? "";
  let response: NextResponse;

  try {
    if (oauthError) {
      throw new Error(errorDescription || oauthError);
    }

    if (!code) {
      throw new Error("Google Workspace OAuth did not return a code.");
    }

    if (expectedState && state !== expectedState) {
      throw new Error("Google Workspace callback state did not match this browser session.");
    }

    const context = await getGoogleWorkspaceContext();
    const credentialsJson = await exchangeGoogleWorkspaceCodeForCredentials(
      code,
      appUrl("/api/openclaw/gws-auth/callback", request).toString()
    );
    await loginOpenClawGoogleWorkspace({
      credentialsJson,
      filename: "credentials.json",
      instance: context.instance
    });

    console.info(
      "[openclaw:gws-callback] complete",
      JSON.stringify({
        source: "oauth_callback",
        userId: context.userId
      })
    );

    response = popupResponse(request, {
      message: "OpenClaw received the Google Workspace credentials.",
      state,
      status: "connected"
    });
  } catch (error) {
    const apiResponse = googleWorkspaceApiError(error);

    if (apiResponse.status >= 500 && !(error instanceof Error)) {
      return apiResponse;
    }

    response = popupResponse(request, {
      message: error instanceof Error ? error.message : "Google Workspace auth failed.",
      state,
      status: "failed"
    });
  }

  response.cookies.delete("gws_oauth_state");

  return response;
}
