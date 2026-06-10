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

export function googleWorkspaceCodeLoginConfig(code: string, redirectUri?: string | null) {
  const config = googleWorkspaceOAuthConfig(redirectUri);

  if (!config.clientId || !config.clientSecret) {
    throw new Error(`missing_${missingGoogleWorkspaceOAuthConfig().join("_").toLowerCase()}`);
  }

  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    code,
    redirectUri: config.redirectUri
  };
}
