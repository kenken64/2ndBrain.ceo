import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "@/lib/env";
import { withSafeGetClaims } from "@/lib/supabase/auth";

export async function createClient() {
  const { supabaseUrl, supabasePublishableKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return withSafeGetClaims(createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Server Components cannot write cookies; the proxy refreshes them.
        }
      }
    }
  }));
}
