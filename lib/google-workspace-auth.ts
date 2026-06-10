import { randomUUID } from "node:crypto";

const GOOGLE_WORKSPACE_DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/pubsub",
  "https://www.googleapis.com/auth/cloud-platform"
];

type GoogleWorkspaceOAuthConfig = {
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string;
  scopes: string[];
};

type GoogleWorkspaceTokenResponse = {
  error?: string;
  error_description?: string;
  refresh_token?: string;
};

function optionalEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();

    if (value) {
      return value;
    }
  }

  return null;
}

function googleWorkspaceOAuthConfig(redirectUri?: string | null): GoogleWorkspaceOAuthConfig {
  const scopes = optionalEnv("GWS_OAUTH_SCOPES", "GOOGLE_WORKSPACE_OAUTH_SCOPES")
    ?.split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  return {
    clientId: optionalEnv("GWS_OAUTH_CLIENT_ID", "GOOGLE_WORKSPACE_OAUTH_CLIENT_ID"),
    clientSecret: optionalEnv("GWS_OAUTH_CLIENT_SECRET", "GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET"),
    redirectUri:
      optionalEnv("GWS_OAUTH_REDIRECT_URI", "GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI") ??
      redirectUri ??
      "http://localhost",
    scopes: scopes?.length ? scopes : GOOGLE_WORKSPACE_DEFAULT_SCOPES
  };
}

export function missingGoogleWorkspaceOAuthConfig() {
  const config = googleWorkspaceOAuthConfig();
  const missing: string[] = [];

  if (!config.clientId) {
    missing.push("GWS_OAUTH_CLIENT_ID");
  }

  if (!config.clientSecret) {
    missing.push("GWS_OAUTH_CLIENT_SECRET");
  }

  return missing;
}

export function buildGoogleWorkspaceAuthUrl(redirectUri?: string | null) {
  const config = googleWorkspaceOAuthConfig(redirectUri);

  if (!config.clientId || !config.clientSecret) {
    throw new Error(`missing_${missingGoogleWorkspaceOAuthConfig().join("_").toLowerCase()}`);
  }

  const state = randomUUID();
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("prompt", "select_account consent");
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", config.scopes.join(" "));
  authUrl.searchParams.set("state", state);

  return {
    authUrl: authUrl.toString(),
    redirectUri: config.redirectUri,
    state
  };
}

export function normalizeGoogleWorkspaceCredentials(value: unknown) {
  let parsed: unknown = value;

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed.length > 64 * 1024) {
      throw new Error("Google Workspace credentials JSON is too large.");
    }

    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      throw new Error("Paste exported GWS credentials JSON, not an invalid JSON document.");
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Google Workspace credentials must be a JSON object.");
  }

  const record = parsed as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.trim() : "";
  const clientId = typeof record.client_id === "string" ? record.client_id.trim() : "";
  const clientSecret = typeof record.client_secret === "string" ? record.client_secret.trim() : "";
  const refreshToken = typeof record.refresh_token === "string" ? record.refresh_token.trim() : "";

  if (type !== "authorized_user" || !clientId || !clientSecret || !refreshToken) {
    throw new Error("Google Workspace token response did not include required authorized_user fields.");
  }

  return `${JSON.stringify(
    {
      type: "authorized_user",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    },
    null,
    2
  )}\n`;
}

export async function exchangeGoogleWorkspaceCodeForCredentials(code: string, redirectUri?: string | null) {
  const config = googleWorkspaceOAuthConfig(redirectUri);

  if (!config.clientId || !config.clientSecret) {
    throw new Error(`missing_${missingGoogleWorkspaceOAuthConfig().join("_").toLowerCase()}`);
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "POST"
  });
  const data = (await response.json().catch(() => null)) as GoogleWorkspaceTokenResponse | null;

  if (!response.ok) {
    throw new Error(data?.error_description || data?.error || "gws_oauth_token_exchange_failed");
  }

  const refreshToken = data?.refresh_token?.trim();

  if (!refreshToken) {
    throw new Error("Google did not return a refresh token. Reopen the login URL and choose consent again.");
  }

  return normalizeGoogleWorkspaceCredentials({
    type: "authorized_user",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken
  });
}
