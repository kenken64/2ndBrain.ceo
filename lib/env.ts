export function hasSupabaseEnv() {
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      supabaseKey
  );
}

export function getSupabaseEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or one of NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  return {
    supabaseUrl,
    supabasePublishableKey
  };
}

export function getSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
    ?.split(",")
    .map((value) => value.trim().replace(/^['"]|['"]$/g, ""))
    .find(Boolean);

  if (!configured) {
    return "http://localhost:3000";
  }

  try {
    const url = new URL(configured);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "http://localhost:3000";
    }

    return url.origin;
  } catch {
    return "http://localhost:3000";
  }
}
