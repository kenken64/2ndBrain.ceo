function cleanEnvValue(value: string | undefined) {
  const cleaned = value?.trim().replace(/^['"]|['"]$/g, "");
  return cleaned || null;
}

function firstEnvValue(names: string[]) {
  for (const name of names) {
    const value = cleanEnvValue(process.env[name]);

    if (value) {
      return value;
    }
  }

  return null;
}

function getSupabaseUrl() {
  return firstEnvValue(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]);
}

function getSupabasePublishableKey() {
  return firstEnvValue([
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY"
  ]);
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

  if (!configured) {
    return null;
  }

  try {
    const url = new URL(configured);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}
