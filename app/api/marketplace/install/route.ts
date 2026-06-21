import { NextResponse } from "next/server";
import { isAdminUser } from "@/lib/admin";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { publishTokenQuotaUpdate } from "@/lib/token-quota-redis";
import { marketplaceItemById } from "@/lib/workflow-templates";
import { normalizeTokenAmount } from "@/lib/workflow-tool-allocations";

export const runtime = "nodejs";

type InstallMarketplaceToolRow = {
  allocated_tokens: number | string;
  allocation_id: string;
  already_installed: boolean;
  available_tokens: number | string;
  charged_tokens: number | string;
  install_id: string;
  item_id: string;
  item_type: string;
  llm_token_quota: number | string;
  llm_token_used: number | string;
  price_tokens: number | string;
  quota_exempt: boolean;
  status: string;
  used_tokens: number | string;
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

function formatTokens(value: number) {
  return new Intl.NumberFormat("en").format(Math.max(0, Math.trunc(value)));
}

function installErrorResponse(error: { message?: string }, requiredTokens: number) {
  const message = error.message ?? "marketplace_install_failed";

  if (message.includes("invalid_marketplace_item") || message.includes("invalid_price_tokens")) {
    return NextResponse.json({ error: "Marketplace item is invalid." }, { status: 400 });
  }

  if (message.includes("profile_not_found")) {
    return NextResponse.json({ error: "Profile was not found." }, { status: 404 });
  }

  if (message.includes("account_disabled")) {
    return NextResponse.json({ error: "Account access is disabled." }, { status: 403 });
  }

  if (message.includes("insufficient_ai_credits")) {
    return NextResponse.json(
      { error: `You need ${formatTokens(requiredTokens)} available AI credits to install this workflow tool.` },
      { status: 402 }
    );
  }

  return NextResponse.json({ error: "Marketplace install failed." }, { status: 500 });
}

export async function POST(request: Request) {
  const auth = await requireUser();

  if (auth.response) {
    return auth.response;
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required for marketplace installs" }, { status: 503 });
  }

  const payload = (await request.json().catch(() => null)) as { itemId?: unknown } | null;
  const itemId = typeof payload?.itemId === "string" ? payload.itemId.trim() : "";
  const item = marketplaceItemById(itemId);

  if (!item) {
    return NextResponse.json({ error: "Marketplace item was not found." }, { status: 404 });
  }

  const adminSupabase = createAdminClient();
  const { data: profile, error: profileError } = await adminSupabase
    .from("profiles")
    .select("email,openclaw_instance")
    .eq("id", auth.userId)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const email = auth.email || profile?.email || null;
  const isAdmin = await isAdminUser(email, auth.userId);
  const { data, error } = await adminSupabase
    .rpc("install_marketplace_tool", {
      p_config: {
        source: "2ndBrain.ceo"
      },
      p_is_admin: isAdmin,
      p_item_id: item.id,
      p_item_type: item.itemType,
      p_price_tokens: item.priceTokens,
      p_repo_url: item.repoUrl ?? null,
      p_title: item.title,
      p_user_id: auth.userId
    })
    .single();

  if (error) {
    return installErrorResponse(error, item.priceTokens);
  }

  const install = data as InstallMarketplaceToolRow;
  const chargedTokens = normalizeTokenAmount(install.charged_tokens);
  const llmTokenQuota = normalizeTokenAmount(install.llm_token_quota);
  const llmTokenUsed = normalizeTokenAmount(install.llm_token_used);

  if (!install.already_installed && chargedTokens > 0) {
    await publishTokenQuotaUpdate({
      actorUserId: auth.userId,
      deltaTokens: -chargedTokens,
      email,
      llmTokenQuota,
      llmTokenUsed,
      openclawInstance: typeof profile?.openclaw_instance === "string" ? profile.openclaw_instance : null,
      metadata: {
        installId: install.install_id,
        itemId: item.id,
        itemType: item.itemType,
        listedPriceTokens: item.priceTokens,
        repoUrl: item.repoUrl ?? null
      },
      reason: "marketplace_tool_purchase",
      userId: auth.userId
    });
  }

  const allocatedTokens = normalizeTokenAmount(install.allocated_tokens);
  const usedTokens = normalizeTokenAmount(install.used_tokens);

  return NextResponse.json({
    balance: {
      availableTokens: normalizeTokenAmount(install.available_tokens),
      llmTokenQuota,
      llmTokenUsed
    },
    install: {
      allocation: {
        allocatedTokens,
        availableTokens: install.quota_exempt ? null : Math.max(0, allocatedTokens - usedTokens),
        quotaExempt: Boolean(install.quota_exempt),
        usedTokens
      },
      alreadyInstalled: Boolean(install.already_installed),
      chargedTokens,
      itemId: install.item_id,
      itemType: install.item_type,
      priceTokens: normalizeTokenAmount(install.price_tokens),
      status: install.status
    },
    isAdmin
  });
}
