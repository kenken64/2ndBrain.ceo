import { NextResponse } from "next/server";
import { isAdminUser } from "@/lib/admin";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalizeTokenAmount } from "@/lib/workflow-tool-allocations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type InstallRow = {
  charged_tokens: number | string | null;
  id: string;
  installed_at: string | null;
  item_id: string;
  item_type: string;
  price_tokens: number | string | null;
  status: string;
};

type AllocationRow = {
  allocated_tokens: number | string | null;
  install_id: string;
  quota_exempt: boolean | null;
  tool_id: string;
  used_tokens: number | string | null;
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
    .select("admin_disabled,admin_deleted_at,email,llm_token_quota,llm_token_used")
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

  const [{ data: installRows, error: installError }, { data: allocationRows, error: allocationError }] =
    await Promise.all([
      adminSupabase
        .from("marketplace_installs")
        .select("id,item_id,item_type,status,price_tokens,charged_tokens,installed_at")
        .eq("user_id", auth.userId)
        .neq("status", "uninstalled"),
      adminSupabase
        .from("workflow_tool_allocations")
        .select("install_id,tool_id,allocated_tokens,used_tokens,quota_exempt")
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
      installedAt: install.installed_at,
      itemId: install.item_id,
      itemType: install.item_type,
      priceTokens: normalizeTokenAmount(install.price_tokens),
      status: install.status
    };
  });
  const llmTokenQuota = normalizeTokenAmount(profile.llm_token_quota);
  const llmTokenUsed = normalizeTokenAmount(profile.llm_token_used);

  return NextResponse.json(
    {
      balance: {
        availableTokens: Math.max(0, llmTokenQuota - llmTokenUsed),
        llmTokenQuota,
        llmTokenUsed
      },
      installs,
      isAdmin: await isAdminUser(auth.email || profile.email, auth.userId)
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
