import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, hasSupabaseEnv } from "@/lib/env";

type UpdateSessionOptions = {
  onAuthenticated?: (context: {
    response: NextResponse;
    supabase: ReturnType<typeof createServerClient>;
    userId: string;
  }) => Promise<NextResponse> | NextResponse;
};

export async function updateSession(request: NextRequest, options: UpdateSessionOptions = {}) {
  if (!hasSupabaseEnv()) {
    return NextResponse.next({ request });
  }

  const { supabaseUrl, supabasePublishableKey } = getSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      }
    }
  });

  const { data } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;

  if (userId && options.onAuthenticated) {
    return options.onAuthenticated({
      response,
      supabase,
      userId
    });
  }

  return response;
}
