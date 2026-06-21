import { NextResponse } from "next/server";
import { isAdminUser } from "@/lib/admin";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { publishTokenQuotaUpdate } from "@/lib/token-quota-redis";
import { normalizeTokenAmount } from "@/lib/workflow-tool-allocations";

export const runtime = "nodejs";

type UnsubscribeMarketplaceToolRow = {
  allocated_tokens: number | string;
  allocation_id: string;
  already_unsubscribed: boolean;
  available_tokens: number | string;
  install_id: string;
  item_id: string;
  item_type: string;
  llm_token_quota: number | string;
  llm_token_used: number | string;
  quota_exempt: boolean;
  refunded_tokens: number | string;
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

function unsubscribeErrorResponse(error: { message?: string }) {
  const message = error.message ?? "marketplace_unsubscribe_failed";

  if (message.includes("invalid_marketplace_item")) {
    return NextResponse.json({ error: "Marketplace item is invalid." }, { status: 400 });
  }

  if (
    message.includes("profile_not_found") ||
    message.includes("install_not_found") ||
    message.includes("allocation_not_found")
  ) {
    return NextResponse.json({ error: "Installed workflow tool was not found." }, { status: 404 });
  }

  if (message.includes("account_disabled")) {
    return NextResponse.json({ error: "Account access is disabled." }, { status: 403 });
  }

  return NextResponse.json({ error: "Marketplace unsubscribe failed." }, { status: 500 });
}

export async function POST(request: Request) {
  const auth = await requireUser();

  if (auth.response) {
    return auth.response;
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required for marketplace unsubscribe" }, { status: 503 });
  }

  const payload = (await request.json().catch(() => null)) as { itemId?: unknown } | null;
  const itemId = typeof payload?.itemId === "string" ? payload.itemId.trim() : "";

  if (!itemId) {
    return NextResponse.json({ error: "Marketplace item is invalid." }, { status: 400 });
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

  const { data, error } = await adminSupabase
    .rpc("unsubscribe_marketplace_tool", {
      p_item_id: itemId,
      p_user_id: auth.userId
    })
    .single();

  if (error) {
    return unsubscribeErrorResponse(error);
  }

  const unsubscribe = data as UnsubscribeMarketplaceToolRow;
  const refundedTokens = normalizeTokenAmount(unsubscribe.refunded_tokens);
  const llmTokenQuota = normalizeTokenAmount(unsubscribe.llm_token_quota);
  const llmTokenUsed = normalizeTokenAmount(unsubscribe.llm_token_used);
  const email = auth.email || profile?.email || null;

  if (!unsubscribe.already_unsubscribed && refundedTokens > 0) {
    await publishTokenQuotaUpdate({
      actorUserId: auth.userId,
      deltaTokens: refundedTokens,
      email,
      llmTokenQuota,
      llmTokenUsed,
      openclawInstance: typeof profile?.openclaw_instance === "string" ? profile.openclaw_instance : null,
      metadata: {
        installId: unsubscribe.install_id,
        itemId: unsubscribe.item_id,
        itemType: unsubscribe.item_type
      },
      reason: "marketplace_tool_refund",
      userId: auth.userId
    });
  }

  const allocatedTokens = normalizeTokenAmount(unsubscribe.allocated_tokens);
  const usedTokens = normalizeTokenAmount(unsubscribe.used_tokens);

  return NextResponse.json({
    balance: {
      availableTokens: normalizeTokenAmount(unsubscribe.available_tokens),
      llmTokenQuota,
      llmTokenUsed
    },
    install: {
      allocation: {
        allocatedTokens,
        availableTokens: unsubscribe.quota_exempt ? null : Math.max(0, allocatedTokens - usedTokens),
        quotaExempt: Boolean(unsubscribe.quota_exempt),
        usedTokens
      },
      alreadyUnsubscribed: Boolean(unsubscribe.already_unsubscribed),
      itemId: unsubscribe.item_id,
      itemType: unsubscribe.item_type,
      refundedTokens,
      status: unsubscribe.status
    },
    isAdmin: await isAdminUser(email, auth.userId)
  });
}
