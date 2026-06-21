import { NextResponse } from "next/server";
import { isAdminUser } from "@/lib/admin";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { publishTokenQuotaUpdate } from "@/lib/token-quota-redis";
import { normalizeTokenAmount } from "@/lib/workflow-tool-allocations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DueInstallRow = {
  user_id: string | null;
};

type ProfileRow = {
  email: string | null;
  id: string;
  openclaw_instance: string | null;
};

type SyncMarketplaceToolRow = {
  available_tokens: number | string;
  charged_tokens: number | string;
  disabled: boolean;
  install_id: string;
  item_id: string;
  item_type: string;
  llm_token_quota: number | string;
  llm_token_used: number | string;
  status: string;
};

function cleanEnvValue(value: string | undefined) {
  const cleaned = value?.trim().replace(/^['"]|['"]$/g, "");

  return cleaned || null;
}

function getBatchLimit() {
  const parsed = Number(cleanEnvValue(process.env.MARKETPLACE_RENEWAL_BATCH_SIZE) ?? "100");

  if (!Number.isFinite(parsed)) {
    return 100;
  }

  return Math.min(500, Math.max(1, Math.trunc(parsed)));
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  return match?.[1]?.trim() || request.headers.get("x-marketplace-renewal-secret")?.trim() || null;
}

function requireRenewalSecret(request: Request) {
  const configuredSecret = cleanEnvValue(process.env.MARKETPLACE_RENEWAL_SECRET);

  if (!configuredSecret) {
    return NextResponse.json({ error: "MARKETPLACE_RENEWAL_SECRET is required for renewal runs." }, { status: 503 });
  }

  if (getBearerToken(request) !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized renewal run." }, { status: 401 });
  }

  return null;
}

export async function POST(request: Request) {
  const secretResponse = requireRenewalSecret(request);

  if (secretResponse) {
    return secretResponse;
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required for marketplace renewals" }, { status: 503 });
  }

  const adminSupabase = createAdminClient();
  const now = new Date().toISOString();
  const { data: dueInstalls, error: dueError } = await adminSupabase
    .from("marketplace_installs")
    .select("user_id")
    .in("status", ["installed", "disabled"])
    .lte("next_charge_at", now)
    .order("next_charge_at", { ascending: true })
    .limit(getBatchLimit());

  if (dueError) {
    return NextResponse.json({ error: dueError.message }, { status: 500 });
  }

  const userIds = Array.from(
    new Set(
      ((dueInstalls ?? []) as DueInstallRow[])
        .map((install) => install.user_id)
        .filter((userId): userId is string => Boolean(userId))
    )
  );

  if (userIds.length === 0) {
    return NextResponse.json({
      chargedTokens: 0,
      disabledTools: 0,
      errors: [],
      renewedTools: 0,
      usersProcessed: 0
    });
  }

  const { data: profiles, error: profilesError } = await adminSupabase
    .from("profiles")
    .select("id,email,openclaw_instance")
    .in("id", userIds);

  if (profilesError) {
    return NextResponse.json({ error: profilesError.message }, { status: 500 });
  }

  const profileByUserId = new Map(((profiles ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]));
  const errors: Array<{ error: string; userId: string }> = [];
  let chargedTokens = 0;
  let disabledTools = 0;
  let renewedTools = 0;

  for (const userId of userIds) {
    const profile = profileByUserId.get(userId);
    const isAdmin = await isAdminUser(profile?.email, userId);
    const { data: syncRows, error: syncError } = await adminSupabase.rpc("sync_marketplace_tool_subscriptions", {
      p_is_admin: isAdmin,
      p_user_id: userId
    });

    if (syncError) {
      errors.push({ error: syncError.message, userId });
      continue;
    }

    for (const row of (syncRows ?? []) as SyncMarketplaceToolRow[]) {
      const rowCharge = normalizeTokenAmount(row.charged_tokens);

      if (row.disabled) {
        disabledTools += 1;
      } else {
        renewedTools += 1;
      }

      if (rowCharge <= 0) {
        continue;
      }

      chargedTokens += rowCharge;
      await publishTokenQuotaUpdate({
        actorUserId: userId,
        deltaTokens: -rowCharge,
        email: profile?.email ?? null,
        llmTokenQuota: normalizeTokenAmount(row.llm_token_quota),
        llmTokenUsed: normalizeTokenAmount(row.llm_token_used),
        openclawInstance: profile?.openclaw_instance ?? null,
        metadata: {
          installId: row.install_id,
          itemId: row.item_id,
          itemType: row.item_type
        },
        reason: "marketplace_tool_renewal",
        userId
      });
    }
  }

  return NextResponse.json({
    chargedTokens,
    disabledTools,
    errors,
    renewedTools,
    usersProcessed: userIds.length
  });
}
