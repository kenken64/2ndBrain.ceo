type AuthErrorLike = {
  code?: unknown;
  message?: unknown;
};

type GetClaimsClient = {
  auth: {
    getClaims: (...args: any[]) => Promise<any>;
  };
};

const SUPABASE_AUTH_COOKIE_PATTERN = /^sb-.+-auth-token(?:\.\d+)?$/;

function getStringProperty(error: unknown, property: keyof AuthErrorLike) {
  if (!error || typeof error !== "object" || !(property in error)) {
    return "";
  }

  const value = (error as AuthErrorLike)[property];

  return typeof value === "string" ? value : "";
}

export function isMissingRefreshTokenError(error: unknown) {
  const code = getStringProperty(error, "code");
  const message = getStringProperty(error, "message").toLowerCase();

  return (
    code === "refresh_token_not_found" ||
    (message.includes("invalid refresh token") && message.includes("refresh token not found"))
  );
}

export function isSupabaseAuthCookieName(name: string) {
  return SUPABASE_AUTH_COOKIE_PATTERN.test(name);
}

export function getSupabaseAuthCookieNames(cookies: { name: string }[]) {
  return [...new Set(cookies.map((cookie) => cookie.name).filter(isSupabaseAuthCookieName))];
}

export function withSafeGetClaims<T extends GetClaimsClient>(client: T) {
  const getClaims = client.auth.getClaims.bind(client.auth) as T["auth"]["getClaims"];

  client.auth.getClaims = (async (...args: Parameters<T["auth"]["getClaims"]>) => {
    try {
      return await getClaims(...args);
    } catch (error) {
      if (isMissingRefreshTokenError(error)) {
        return { data: null, error };
      }

      throw error;
    }
  }) as T["auth"]["getClaims"];

  return client;
}
