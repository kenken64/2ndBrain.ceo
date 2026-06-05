import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/env";

function cleanEnvValue(value: string | undefined) {
  const cleaned = value?.trim().replace(/^['"]|['"]$/g, "");
  return cleaned || null;
}

const SUPABASE_SERVICE_ROLE_ENV_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "SERVICE_ROLE_KEY"
] as const;

export function getSupabaseServiceRoleKeySource() {
  for (const name of SUPABASE_SERVICE_ROLE_ENV_NAMES) {
    const value = cleanEnvValue(process.env[name]);

    if (value) {
      return { name, value };
    }
  }

  return null;
}

export function getSupabaseServiceRoleKey() {
  return getSupabaseServiceRoleKeySource()?.value ?? null;
}

export function hasSupabaseServiceRoleEnv() {
  return Boolean(getSupabaseServiceRoleKey());
}

export function createAdminClient() {
  const { supabaseUrl } = getSupabaseEnv();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!serviceRoleKey) {
    throw new Error("missing_supabase_service_role_key");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
