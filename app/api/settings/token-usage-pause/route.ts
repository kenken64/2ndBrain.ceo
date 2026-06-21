import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { publishTokenQuotaUpdate } from "@/lib/token-quota-redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProfileRow = {
  admin_deleted_at: string | null;
  admin_disabled: boolean | null;
  email: string | null;
  llm_token_quota: number | string | null;
  llm_token_used: number | string | null;
  openclaw_instance: string | null;
  openclaw_tokens_pause_reason: string | null;
  openclaw_tokens_paused: boolean | null;
  openclaw_tokens_paused_at: string | null;
  openclaw_tokens_resumed_at: string | null;
};

function normalizeTokenAmount(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);

  if (!Number.isFinite(amount)) {
    return 0;
  }

  return Math.max(0, Math.trunc(amount));
}

async function requireUser() {
  if (!hasSupabaseEnv()) {
    return {
      response: NextResponse.json({ error: "Supabase is not configured" }, { status: 503 })
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);
  const email = typeof data?.claims?.email === "string" ? data.claims.email.toLowerCase() : "";

  if (error || !userId) {
    return {
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 })
    };
  }

  return {
    email,
    response: null,
    userId
  };
}

function pauseStatus(profile: ProfileRow) {
  return {
    openclawTokensPauseReason: profile.openclaw_tokens_pause_reason,
    openclawTokensPaused: Boolean(profile.openclaw_tokens_paused),
    openclawTokensPausedAt: profile.openclaw_tokens_paused_at,
    openclawTokensResumedAt: profile.openclaw_tokens_resumed_at
  };
}

export async function PATCH(request: Request) {
  const auth = await requireUser();

  if (auth.response) {
    return auth.response;
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required for OpenClaw pause controls" }, { status: 503 });
  }

  const payload = (await request.json().catch(() => null)) as { paused?: unknown } | null;

  if (typeof payload?.paused !== "boolean") {
    return NextResponse.json({ error: "Paused must be true or false." }, { status: 400 });
  }

  const adminSupabase = createAdminClient();
  const { data: currentProfile, error: currentProfileError } = await adminSupabase
    .from("profiles")
    .select("admin_deleted_at,admin_disabled,email,llm_token_quota,llm_token_used,openclaw_instance,openclaw_tokens_paused,openclaw_tokens_paused_at,openclaw_tokens_resumed_at,openclaw_tokens_pause_reason")
    .eq("id", auth.userId)
    .maybeSingle();

  if (currentProfileError) {
    return NextResponse.json({ error: currentProfileError.message }, { status: 500 });
  }

  if (!currentProfile) {
    return NextResponse.json({ error: "Profile was not found." }, { status: 404 });
  }

  const profile = currentProfile as ProfileRow;

  if (profile.admin_disabled || profile.admin_deleted_at) {
    return NextResponse.json({ error: "Account access is disabled." }, { status: 403 });
  }

  const openclawInstance = typeof profile.openclaw_instance === "string" ? profile.openclaw_instance.trim() : "";

  if (!openclawInstance) {
    return NextResponse.json({ error: "OpenClaw instance is not available." }, { status: 409 });
  }

  if (Boolean(profile.openclaw_tokens_paused) === payload.paused) {
    return NextResponse.json({
      balance: {
        availableTokens: Math.max(
          0,
          normalizeTokenAmount(profile.llm_token_quota) - normalizeTokenAmount(profile.llm_token_used)
        ),
        llmTokenQuota: normalizeTokenAmount(profile.llm_token_quota),
        llmTokenUsed: normalizeTokenAmount(profile.llm_token_used)
      },
      pause: pauseStatus(profile)
    });
  }

  const now = new Date().toISOString();
  const updates = payload.paused
    ? {
        openclaw_tokens_pause_actor_email: auth.email || profile.email,
        openclaw_tokens_pause_actor_id: auth.userId,
        openclaw_tokens_pause_reason: "user_pause",
        openclaw_tokens_paused: true,
        openclaw_tokens_paused_at: now
      }
    : {
        openclaw_tokens_pause_actor_email: auth.email || profile.email,
        openclaw_tokens_pause_actor_id: auth.userId,
        openclaw_tokens_pause_reason: null,
        openclaw_tokens_paused: false,
        openclaw_tokens_resumed_at: now
      };

  const { data: updatedProfile, error: updateError } = await adminSupabase
    .from("profiles")
    .update(updates)
    .eq("id", auth.userId)
    .select("email,llm_token_quota,llm_token_used,openclaw_instance,openclaw_tokens_paused,openclaw_tokens_paused_at,openclaw_tokens_resumed_at,openclaw_tokens_pause_reason")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (!updatedProfile) {
    return NextResponse.json({ error: "Profile was not found." }, { status: 404 });
  }

  const updated = updatedProfile as ProfileRow;
  const llmTokenQuota = normalizeTokenAmount(updated.llm_token_quota);
  const llmTokenUsed = normalizeTokenAmount(updated.llm_token_used);

  await publishTokenQuotaUpdate({
    actorEmail: auth.email || updated.email,
    actorUserId: auth.userId,
    deltaTokens: 0,
    email: updated.email ?? auth.email,
    llmTokenQuota,
    llmTokenUsed,
    openclawInstance,
    openclawTokensPaused: Boolean(updated.openclaw_tokens_paused),
    openclawTokensPausedAt: updated.openclaw_tokens_paused_at,
    openclawTokensPauseReason: updated.openclaw_tokens_pause_reason,
    openclawTokensResumedAt: updated.openclaw_tokens_resumed_at,
    metadata: {
      action: payload.paused ? "pause" : "resume",
      openclawTokensPaused: Boolean(updated.openclaw_tokens_paused)
    },
    reason: payload.paused ? "openclaw_tokens_paused" : "openclaw_tokens_resumed",
    userId: auth.userId
  });

  return NextResponse.json({
    balance: {
      availableTokens: Math.max(0, llmTokenQuota - llmTokenUsed),
      llmTokenQuota,
      llmTokenUsed
    },
    pause: pauseStatus(updated)
  });
}
