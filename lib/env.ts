function cleanEnvValue(value: string | undefined) {
  const cleaned = value?.trim().replace(/^['"]|['"]$/g, "");
  return cleaned || null;
}

const SUPABASE_URL_ENV_NAMES = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"] as const;
const SUPABASE_KEY_ENV_NAMES = [
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY"
] as const;

function firstEnvMatch(names: readonly string[]) {
  for (const name of names) {
    const value = cleanEnvValue(process.env[name]);

    if (value) {
      return { name, value };
    }
  }

  return null;
}

function getSupabaseUrl() {
  return firstEnvMatch(SUPABASE_URL_ENV_NAMES)?.value ?? null;
}

function getSupabasePublishableKey() {
  return firstEnvMatch(SUPABASE_KEY_ENV_NAMES)?.value ?? null;
}

export function getSupabaseEnvStatus() {
  const url = firstEnvMatch(SUPABASE_URL_ENV_NAMES);
  const key = firstEnvMatch(SUPABASE_KEY_ENV_NAMES);
  const siteUrl = cleanEnvValue(process.env.NEXT_PUBLIC_SITE_URL)
    ? { name: "NEXT_PUBLIC_SITE_URL" }
    : cleanEnvValue(process.env.RAILWAY_PUBLIC_DOMAIN)
      ? { name: "RAILWAY_PUBLIC_DOMAIN" }
      : null;

  return {
    keyConfigured: Boolean(key),
    keySource: key?.name ?? null,
    siteUrlConfigured: Boolean(siteUrl && getConfiguredSiteUrl()),
    siteUrlSource: siteUrl?.name ?? null,
    urlConfigured: Boolean(url),
    urlSource: url?.name ?? null
  };
}

export function hasSupabaseEnv() {
  return Boolean(getSupabaseUrl() && getSupabasePublishableKey());
}

export function getSupabaseEnv() {
  const supabaseUrl = getSupabaseUrl();
  const supabasePublishableKey = getSupabasePublishableKey();

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Missing Supabase URL or anon/publishable key. Set NEXT_PUBLIC_SUPABASE_URL plus NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/NEXT_PUBLIC_SUPABASE_ANON_KEY, or Railway aliases SUPABASE_URL plus SUPABASE_PUBLISHABLE_KEY/SUPABASE_ANON_KEY."
    );
  }

  return {
    supabaseUrl,
    supabasePublishableKey
  };
}

export function getSiteUrl() {
  const configured = getConfiguredSiteUrl();

  return configured ?? "http://localhost:3000";
}

export function getConfiguredSiteUrl() {
  const configured = cleanEnvValue(process.env.NEXT_PUBLIC_SITE_URL)
    ?.split(",")
    .map((value) => value.trim())
    .find(Boolean);
  const railwayDomain = cleanEnvValue(process.env.RAILWAY_PUBLIC_DOMAIN);
  const candidate = configured ?? railwayDomain;

  if (!candidate) {
    return null;
  }

  try {
    const url = new URL(candidate.startsWith("http") ? candidate : `https://${candidate}`);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}
