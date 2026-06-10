import { NextResponse, type NextRequest } from "next/server";
import {
  buildGoogleWorkspaceAuthUrl,
  missingGoogleWorkspaceOAuthConfig
} from "@/lib/google-workspace-auth";
import {
  getGoogleWorkspaceContext,
  googleWorkspaceApiError
} from "@/lib/google-workspace-context";
import { appUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await getGoogleWorkspaceContext();

    const missing = missingGoogleWorkspaceOAuthConfig();

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `Google Workspace OAuth is not configured. Set ${missing.join(" and ")}.`,
          missing
        },
        { status: 503 }
      );
    }

    const callbackUrl = appUrl("/api/openclaw/gws-auth/callback", request).toString();
    const result = buildGoogleWorkspaceAuthUrl(callbackUrl);
    const response = NextResponse.json({
      authUrl: result.authUrl,
      ok: true,
      redirectUri: result.redirectUri,
      state: result.state
    });

    response.cookies.set("gws_oauth_state", result.state, {
      httpOnly: true,
      maxAge: 10 * 60,
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:"
    });

    return response;
  } catch (error) {
    return googleWorkspaceApiError(error);
  }
}
