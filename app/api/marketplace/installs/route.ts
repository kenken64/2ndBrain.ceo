import { NextResponse } from "next/server";
import { isAdminUser } from "@/lib/admin";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { publishTokenQuotaUpdate } from "@/lib/token-quota-redis";
import { normalizeTokenAmount } from "@/lib/workflow-tool-allocations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type InstallRow = {
  charged_tokens: number | string | null;
  current_period_started_at: string | null;
  disabled_at: string | null;
  disabled_reason: string | null;
  id: string;
  installed_at: string | null;
  item_id: string;
  item_type: string;
  last_charged_at: string | null;
  next_charge_at: string | null;
  price_tokens: number | string | null;
  status: string;
  unsubscribed_at: string | null;
};

type AllocationRow = {
  allocated_tokens: number | string | null;
  install_id: string;
  quota_exempt: boolean | null;
  status: string | null;
  tool_id: string;
  used_tokens: number | string | null;
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

export async function GET() {
  const auth = await requireUser();

  if (auth.response) {
    return auth.response;
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required for marketplace installs" }, { status: 503 });
  }

  const adminSupabase = createAdminClient();
  const { data: profile, error: profileError } = await adminSupabase
    .from("profiles")
    .select("admin_disabled,admin_deleted_at,email,llm_token_quota,llm_token_used,openclaw_instance")
    .eq("id", auth.userId)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (!profile) {
    return NextResponse.json({ error: "Profile was not found." }, { status: 404 });
  }

  if (profile.admin_disabled || profile.admin_deleted_at) {
    return NextResponse.json({ error: "Account access is disabled" }, { status: 403 });
  }

  const isAdmin = await isAdminUser(auth.email || profile.email, auth.userId);
  const { data: syncRows, error: syncError } = await adminSupabase
    .rpc("sync_marketplace_tool_subscriptions", {
      p_is_admin: isAdmin,
      p_user_id: auth.userId
    });

  if (syncError) {
    return NextResponse.json({ error: syncError.message }, { status: 500 });
  }

  await Promise.all(
    ((syncRows ?? []) as SyncMarketplaceToolRow[])
      .filter((row) => normalizeTokenAmount(row.charged_tokens) > 0)
      .map((row) =>
        publishTokenQuotaUpdate({
          actorUserId: auth.userId,
          deltaTokens: -normalizeTokenAmount(row.charged_tokens),
          email: auth.email || profile.email || null,
          llmTokenQuota: normalizeTokenAmount(row.llm_token_quota),
          llmTokenUsed: normalizeTokenAmount(row.llm_token_used),
          openclawInstance: typeof profile.openclaw_instance === "string" ? profile.openclaw_instance : null,
          metadata: {
            installId: row.install_id,
            itemId: row.item_id,
            itemType: row.item_type
          },
          reason: "marketplace_tool_renewal",
          userId: auth.userId
        })
      )
  );

  const { data: currentProfile, error: currentProfileError } = await adminSupabase
    .from("profiles")
    .select("email,llm_token_quota,llm_token_used")
    .eq("id", auth.userId)
    .maybeSingle();

  if (currentProfileError) {
    return NextResponse.json({ error: currentProfileError.message }, { status: 500 });
  }

  const [{ data: installRows, error: installError }, { data: allocationRows, error: allocationError }] =
    await Promise.all([
      adminSupabase
        .from("marketplace_installs")
        .select("id,item_id,item_type,status,price_tokens,charged_tokens,installed_at,current_period_started_at,last_charged_at,next_charge_at,unsubscribed_at,disabled_at,disabled_reason")
        .eq("user_id", auth.userId)
        .neq("status", "uninstalled"),
      adminSupabase
        .from("workflow_tool_allocations")
        .select("install_id,tool_id,allocated_tokens,used_tokens,quota_exempt,status")
        .eq("user_id", auth.userId)
        .neq("status", "closed")
    ]);

  if (installError) {
    return NextResponse.json({ error: installError.message }, { status: 500 });
  }

  if (allocationError) {
    return NextResponse.json({ error: allocationError.message }, { status: 500 });
  }

  const allocationsByInstallId = new Map(
    ((allocationRows ?? []) as AllocationRow[]).map((allocation) => [allocation.install_id, allocation])
  );
  const installs = ((installRows ?? []) as InstallRow[]).map((install) => {
    const allocation = allocationsByInstallId.get(install.id);
    const allocatedTokens = normalizeTokenAmount(allocation?.allocated_tokens);
    const usedTokens = normalizeTokenAmount(allocation?.used_tokens);
    const quotaExempt = Boolean(allocation?.quota_exempt);

    return {
      allocation: allocation
        ? {
            allocatedTokens,
            availableTokens: quotaExempt ? null : Math.max(0, allocatedTokens - usedTokens),
            quotaExempt,
            usedTokens
          }
        : null,
      chargedTokens: normalizeTokenAmount(install.charged_tokens),
      currentPeriodStartedAt: install.current_period_started_at,
      disabledAt: install.disabled_at,
      disabledReason: install.disabled_reason,
      installedAt: install.installed_at,
      itemId: install.item_id,
      itemType: install.item_type,
      lastChargedAt: install.last_charged_at,
      nextChargeAt: install.next_charge_at,
      priceTokens: normalizeTokenAmount(install.price_tokens),
      status: install.status,
      unsubscribedAt: install.unsubscribed_at
    };
  });
  const balanceProfile = currentProfile ?? profile;
  const llmTokenQuota = normalizeTokenAmount(balanceProfile.llm_token_quota);
  const llmTokenUsed = normalizeTokenAmount(balanceProfile.llm_token_used);

  return NextResponse.json(
    {
      balance: {
        availableTokens: Math.max(0, llmTokenQuota - llmTokenUsed),
        llmTokenQuota,
        llmTokenUsed
      },
      installs,
      isAdmin
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
