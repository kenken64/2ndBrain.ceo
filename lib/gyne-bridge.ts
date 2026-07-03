import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";

function cleanEnvValue(value: string | undefined) {
  const cleaned = value?.trim().replace(/^['"]|['"]$/g, "");

  return cleaned || null;
}

function configuredBridgeSecret() {
  return cleanEnvValue(process.env.GYNE_BRAIN_API_SECRET);
}

function requestBridgeSecret(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";

  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
}

export type GyneBridgeContext = {
  adminSupabase: SupabaseClient;
  userId: string;
};

/**
 * Auth guard shared by the /api/gyne/* bridge routes. The Gyne Agent publisher authenticates the
 * browser via its launch session, then forwards here server-to-server with the shared bridge
 * secret and the session's user_id as a query parameter.
 */
export function authorizeGyneBridge(
  request: Request
): { ok: true; context: GyneBridgeContext } | { ok: false; response: NextResponse } {
  const secret = configuredBridgeSecret();

  if (!secret) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "GYNE_BRAIN_API_SECRET is not configured" },
        { status: 503 }
      )
    };
  }

  if (requestBridgeSecret(request) !== secret) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid gyne bridge secret" }, { status: 401 })
    };
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY is required for the gyne bridge" },
        { status: 503 }
      )
    };
  }

  const url = new URL(request.url);
  const userId = url.searchParams.get("user_id")?.trim() ?? "";

  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "user_id_required" }, { status: 400 })
    };
  }

  return { ok: true, context: { adminSupabase: createAdminClient(), userId } };
}
