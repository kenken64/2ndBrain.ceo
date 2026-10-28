import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { logAdminAudit } from "@/lib/admin";
import { REAPER_GRACE_DAYS, reapUnfundedInstances } from "@/lib/instance-reaper";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Tearing down several Lightsail instances in one sweep is slow.
export const maxDuration = 900;

function secretMatches(provided: string) {
  const expected = process.env.INSTANCE_REAPER_SECRET?.trim() ?? "";

  if (!expected || !provided) {
    return false;
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Sweeps unfunded AI Agent instances. Driven by the in-process scheduler in
 * server/instance-reaper.js; the logic lives here so it can reuse the
 * TypeScript AI Agent and Supabase helpers rather than duplicating clawmacdo
 * and AWS env handling in the CommonJS server.
 *
 * Guarded by a shared secret because the route is reachable like any other.
 */
export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-reaper-secret")?.trim() ?? "")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required" }, { status: 503 });
  }

  const adminSupabase = createAdminClient();

  try {
    const { outcomes, scanned } = await reapUnfundedInstances(adminSupabase);

    for (const outcome of outcomes) {
      await logAdminAudit(adminSupabase, {
        action: "instance_reaped",
        adminEmail: "system@reaper",
        adminUserId: null,
        details: {
          error: outcome.error ?? null,
          graceDays: REAPER_GRACE_DAYS,
          instance: outcome.instance,
          reason: outcome.reason
        },
        status: outcome.reason === "failed" ? "failed" : "success",
        targetEmail: outcome.email,
        targetUserId: null
      });
    }

    return NextResponse.json(
      { ok: true, reaped: outcomes.filter((o) => o.reason !== "failed").length, scanned },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "reap_failed";
    console.error("[instance-reaper] sweep failed", { message });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
