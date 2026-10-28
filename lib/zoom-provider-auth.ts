import "server-only";
import { createClient, type Session } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/env";

// A separate memory-only client: never reads/writes the site's Supabase cookies,
// localStorage, primary code verifier, or onAuthStateChange subscribers.
export function zoomProviderClient(session?: Session, verifier?: string) {
  const { supabaseUrl, supabasePublishableKey } = getSupabaseEnv();
  const key = "2ndbrain-zoom-connection";
  const items = new Map<string,string>();
  if (session) items.set(key, JSON.stringify({ ...session, refresh_token: "", expires_at: Math.floor(Date.now() / 1000) + 3600, provider_token: undefined, provider_refresh_token: undefined }));
  if (verifier) items.set(key + "-code-verifier", verifier);
  const client = createClient(supabaseUrl, supabasePublishableKey, { auth: {
    storageKey: key, flowType: "pkce", autoRefreshToken: false, detectSessionInUrl: false, persistSession: true,
    storage: { getItem: name => items.get(name) ?? null, setItem: (name,value) => { items.set(name,value); }, removeItem: name => { items.delete(name); } },
  } });
  return { client, verifier: () => items.get(key + "-code-verifier") };
}
