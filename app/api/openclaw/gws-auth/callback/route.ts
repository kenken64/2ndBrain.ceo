import { NextResponse, type NextRequest } from "next/server";
import { appUrl, getRequestOrigin } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function scriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function htmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function popupResponse(request: NextRequest, payload: Record<string, string>) {
  const origin = getRequestOrigin(request);
  const settingsUrl = appUrl("/dashboard/settings?tab=integrations", request).toString();
  const completeUrl = appUrl("/api/openclaw/gws-auth/complete", request).toString();
  const isAuthorized = payload.status === "authorized";

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
      <h1>${isAuthorized ? "Google Workspace authorized" : "Google Workspace auth failed"}</h1>
      <p>${htmlText(payload.message)}</p>
      <a href="${settingsUrl}">Return to settings</a>
    </main>
    <script>
      const payload = ${scriptJson(payload)};
      const settingsUrl = ${scriptJson(settingsUrl)};
      const completeUrl = ${scriptJson(completeUrl)};
      const title = document.querySelector("h1");
      const message = document.querySelector("p");

      function notifyOpener() {
        try {
          const channel = new BroadcastChannel("2ndbrain:gws-auth");
          channel.postMessage(payload);
          channel.close();
        } catch {}
        try {
          window.opener?.postMessage(payload, ${scriptJson(origin)});
        } catch {}
      }

      async function completeWithoutOpener() {
        if (payload.status !== "authorized") {
          return;
        }

        if (message) {
          message.textContent = "Installing Google Workspace credentials on OpenClaw...";
        }

        try {
          const response = await fetch(completeUrl, {
            body: JSON.stringify({
              code: payload.code,
              state: payload.state
            }),
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json"
            },
            method: "POST"
          });
          const data = await response.json().catch(() => null);

          if (!response.ok) {
            throw new Error(data?.error || "Google Workspace auth failed.");
          }

          window.location.replace(settingsUrl);
        } catch (error) {
          if (title) {
            title.textContent = "Google Workspace auth failed";
          }
          if (message) {
            message.textContent = error instanceof Error ? error.message : "Google Workspace auth failed.";
          }
        }
      }

      const hasOpener = Boolean(window.opener && !window.opener.closed);

      if (hasOpener) {
        notifyOpener();
        try {
          window.opener.focus();
        } catch {}
        if (payload.status === "authorized") {
          window.setTimeout(() => window.close(), 150);
        }
      } else {
        notifyOpener();
        void completeWithoutOpener();
      }
    </script>
  </body>
</html>`,
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer"
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

    if (!expectedState || !state || state !== expectedState) {
      throw new Error("Google Workspace callback state did not match this browser session.");
    }

    response = popupResponse(request, {
      code,
      message: "Google authorized. Returning to settings while OpenClaw installs the credentials.",
      state,
      status: "authorized"
    });
  } catch (error) {
    response = popupResponse(request, {
      message: error instanceof Error ? error.message : "Google Workspace auth failed.",
      state,
      status: "failed"
    });
  }

  return response;
}
