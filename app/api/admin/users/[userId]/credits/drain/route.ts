import { NextResponse } from "next/server";
import { getAdminAccess, isAdminUser, logAdminAudit } from "@/lib/admin";
import { publishTokenQuotaUpdate } from "@/lib/token-quota-redis";

export const runtime = "nodejs";

type AdminUserRouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

type CreditDrainRow = {
  amount_tokens: number | string;
  recipient_available_tokens: number | string;
  recipient_email: string;
  recipient_llm_token_quota: number | string;
  recipient_llm_token_used: number | string;
  recipient_user_id: string;
  sender_available_tokens: number | string;
  sender_email: string | null;
  sender_llm_token_quota: number | string;
  sender_llm_token_used: number | string;
  sender_user_id: string;
  transfer_id: string;
};

type TargetCreditProfile = {
  email: string | null;
  id: string;
  llm_token_quota: number | string | null;
  llm_token_used: number | string | null;
};

function rpcErrorResponse(error: { message?: string }) {
  const message = error.message ?? "admin_credit_drain_failed";

  if (message.includes("recipient_email_required")) {
    return NextResponse.json({ error: "Admin account email is required to receive drained AI credits." }, { status: 400 });
  }

  if (message.includes("recipient_not_found")) {
    return NextResponse.json({ error: "Admin account profile was not found." }, { status: 404 });
  }

  if (message.includes("recipient_is_sender")) {
    return NextResponse.json({ error: "Admins cannot drain AI credits from their own account." }, { status: 409 });
  }

  if (message.includes("recipient_email_ambiguous")) {
    return NextResponse.json({ error: "More than one profile uses the admin email address." }, { status: 409 });
  }

  if (message.includes("insufficient_ai_credits")) {
    return NextResponse.json({ error: "This user no longer has enough unused AI credits to drain." }, { status: 409 });
  }

  return NextResponse.json({ error: "AI credit drain failed." }, { status: 500 });
}

export async function POST(_request: Request, context: AdminUserRouteContext) {
  const access = await getAdminAccess();

  if (!access.ok) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }

  if (!access.adminSupabase) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required" }, { status: 503 });
  }

  const { userId } = await context.params;

  if (userId === access.userId) {
    return NextResponse.json({ error: "Admins cannot drain AI credits from their own account." }, { status: 400 });
  }

  const { data: target, error: targetError } = await access.adminSupabase
    .from("profiles")
    .select("id,email,llm_token_quota,llm_token_used")
    .eq("id", userId)
    .maybeSingle();

  if (targetError) {
    return NextResponse.json({ error: targetError.message }, { status: 500 });
  }

  if (!target) {
    return NextResponse.json({ error: "target_user_not_found" }, { status: 404 });
  }

  const targetProfile = target as TargetCreditProfile;

  if (await isAdminUser(targetProfile.email, userId)) {
    return NextResponse.json({ error: "Admin accounts are exempt from AI credit quotas." }, { status: 409 });
  }

  const targetQuota = Number(targetProfile.llm_token_quota ?? 0);
  const targetUsed = Number(targetProfile.llm_token_used ?? 0);
  const amountTokens = Math.max(0, targetQuota - targetUsed);

  if (!Number.isSafeInteger(amountTokens) || amountTokens <= 0) {
    return NextResponse.json({ error: "This user has no unused AI credits to drain." }, { status: 409 });
  }

  const { data, error } = await access.adminSupabase
    .rpc("transfer_ai_credits", {
      p_amount_tokens: amountTokens,
      p_recipient_email: access.email,
      p_sender_user_id: userId
    })
    .single();

  if (error) {
    await logAdminAudit(access.adminSupabase, {
      action: "ai_credit_admin_drain",
      adminEmail: access.email,
      adminUserId: access.userId,
      details: {
        amountTokens,
        error: error.message
      },
      status: "failed",
      targetEmail: targetProfile.email,
      targetUserId: userId
    });

    return rpcErrorResponse(error);
  }

  const drain = data as CreditDrainRow;

  await logAdminAudit(access.adminSupabase, {
    action: "ai_credit_admin_drain",
    adminEmail: access.email,
    adminUserId: access.userId,
    details: {
      amountTokens: Number(drain.amount_tokens),
      adminAvailableTokens: Number(drain.recipient_available_tokens),
      transferId: drain.transfer_id,
      userAvailableTokens: Number(drain.sender_available_tokens)
    },
    targetEmail: targetProfile.email,
    targetUserId: userId
  });

  await Promise.all([
    publishTokenQuotaUpdate({
      actorEmail: access.email,
      actorUserId: access.userId,
      deltaTokens: -Number(drain.amount_tokens),
      email: drain.sender_email,
      llmTokenQuota: Number(drain.sender_llm_token_quota),
      llmTokenUsed: Number(drain.sender_llm_token_used),
      metadata: {
        transferId: drain.transfer_id
      },
      reason: "admin_credit_drain_from_user",
      userId: drain.sender_user_id
    }),
    publishTokenQuotaUpdate({
      actorEmail: access.email,
      actorUserId: access.userId,
      deltaTokens: Number(drain.amount_tokens),
      email: drain.recipient_email,
      llmTokenQuota: Number(drain.recipient_llm_token_quota),
      llmTokenUsed: Number(drain.recipient_llm_token_used),
      metadata: {
        sourceUserId: drain.sender_user_id,
        transferId: drain.transfer_id
      },
      reason: "admin_credit_drain_to_admin",
      userId: drain.recipient_user_id
    })
  ]);

  return NextResponse.json({
    drain: {
      amountTokens: Number(drain.amount_tokens),
      admin: {
        availableTokens: Number(drain.recipient_available_tokens),
        email: drain.recipient_email,
        llmTokenQuota: Number(drain.recipient_llm_token_quota),
        llmTokenUsed: Number(drain.recipient_llm_token_used),
        userId: drain.recipient_user_id
      },
      transferId: drain.transfer_id,
      user: {
        availableTokens: Number(drain.sender_available_tokens),
        email: drain.sender_email,
        llmTokenQuota: Number(drain.sender_llm_token_quota),
        llmTokenUsed: Number(drain.sender_llm_token_used),
        userId: drain.sender_user_id
      }
    }
  });
}
