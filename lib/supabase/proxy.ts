import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, hasSupabaseEnv } from "@/lib/env";
import {
  getSupabaseAuthCookieNames,
  isMissingRefreshTokenError,
  withSafeGetClaims
} from "@/lib/supabase/auth";

type UpdateSessionOptions = {
  onAuthenticated?: (context: {
    email: string | null;
    response: NextResponse;
    supabase: ReturnType<typeof createServerClient>;
    userId: string;
  }) => Promise<NextResponse> | NextResponse;
};

function clearSupabaseAuthCookies(request: NextRequest, response: NextResponse) {
  const cookieNames = getSupabaseAuthCookieNames(request.cookies.getAll());

  cookieNames.forEach((name) => {
    request.cookies.delete(name);
    response.cookies.set(name, "", {
      maxAge: 0,
      path: "/",
      sameSite: "lax"
    });
  });
}

export async function updateSession(request: NextRequest, options: UpdateSessionOptions = {}) {
  if (!hasSupabaseEnv()) {
    return NextResponse.next({ request });
  }

  const { supabaseUrl, supabasePublishableKey } = getSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = withSafeGetClaims(createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          if (options?.maxAge === 0) {
            request.cookies.delete(name);
          } else {
            request.cookies.set(name, value);
          }
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      }
    }
  }));

  const { data, error } = await supabase.auth.getClaims();

  if (isMissingRefreshTokenError(error)) {
    clearSupabaseAuthCookies(request, response);

    return response;
  }

  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  const email = typeof data?.claims?.email === "string" ? data.claims.email.toLowerCase() : null;

  if (userId && options.onAuthenticated) {
    return options.onAuthenticated({
      email,
      response,
      supabase,
      userId
    });
  }

  return response;
}
