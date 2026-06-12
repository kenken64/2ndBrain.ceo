import { NextResponse } from "next/server";
import { isAdminUser } from "@/lib/admin";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { publishTokenQuotaUpdate } from "@/lib/token-quota-redis";

export const runtime = "nodejs";

type CreditTransferRow = {
  amount_tokens: number | string;
  recipient_available_tokens: number | string;
  recipient_display_name: string | null;
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

type OpenClawInstanceRow = {
  id: string;
  openclaw_instance: string | null;
};

function normalizeEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }

  return email;
}

function normalizeAmount(value: unknown) {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";

  if (!/^\d+$/.test(text)) {
    return null;
  }

  const amount = Number(text);

  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function rpcErrorResponse(error: { message?: string }) {
  const message = error.message ?? "credit_transfer_failed";

  if (message.includes("recipient_email_required") || message.includes("invalid_transfer_amount")) {
    return NextResponse.json({ error: "Recipient email and transfer amount are required." }, { status: 400 });
  }

  if (message.includes("recipient_not_found")) {
    return NextResponse.json({ error: "No user found with that email address." }, { status: 404 });
  }

  if (message.includes("recipient_is_sender")) {
    return NextResponse.json({ error: "Choose another user to receive AI credits." }, { status: 409 });
  }

  if (message.includes("recipient_email_ambiguous")) {
    return NextResponse.json({ error: "More than one profile uses that email address." }, { status: 409 });
  }

  if (message.includes("insufficient_ai_credits")) {
    return NextResponse.json({ error: "Transfer amount exceeds your available AI credits." }, { status: 409 });
  }

  return NextResponse.json({ error: "AI credit transfer failed." }, { status: 500 });
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

  if (error || !userId) {
    return {
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 })
    };
  }

  return {
    response: null,
    userId
  };
}

export async function POST(request: Request) {
  const auth = await requireUser();

  if (auth.response) {
    return auth.response;
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required for credit transfers" }, { status: 503 });
  }

  const payload = (await request.json().catch(() => null)) as {
    amountTokens?: unknown;
    recipientEmail?: unknown;
  } | null;
  const recipientEmail = normalizeEmail(payload?.recipientEmail);
  const amountTokens = normalizeAmount(payload?.amountTokens);

  if (!recipientEmail) {
    return NextResponse.json({ error: "Enter a valid recipient email address." }, { status: 400 });
  }

  if (!amountTokens) {
    return NextResponse.json({ error: "Enter a positive AI credit amount." }, { status: 400 });
  }

  if (await isAdminUser(recipientEmail, null)) {
    return NextResponse.json({ error: "Admin accounts are exempt from AI credit quotas." }, { status: 409 });
  }

  const adminSupabase = createAdminClient();
  const { data, error } = await adminSupabase
    .rpc("transfer_ai_credits", {
      p_amount_tokens: amountTokens,
      p_recipient_email: recipientEmail,
      p_sender_user_id: auth.userId
    })
    .single();

  if (error) {
    return rpcErrorResponse(error);
  }

  const transfer = data as CreditTransferRow;
  const { data: instanceRows, error: instanceError } = await adminSupabase
    .from("profiles")
    .select("id,openclaw_instance")
    .in("id", [transfer.sender_user_id, transfer.recipient_user_id]);

  if (instanceError) {
    console.error("[token-quota-redis] failed to load transfer profile instances", instanceError);
  }

  const instanceByUserId = new Map(
    ((instanceRows ?? []) as OpenClawInstanceRow[]).map((row) => [row.id, row.openclaw_instance])
  );

  await Promise.all([
    publishTokenQuotaUpdate({
      actorUserId: auth.userId,
      deltaTokens: -Number(transfer.amount_tokens),
      email: transfer.sender_email,
      llmTokenQuota: Number(transfer.sender_llm_token_quota),
      llmTokenUsed: Number(transfer.sender_llm_token_used),
      openclawInstance: instanceByUserId.get(transfer.sender_user_id) ?? null,
      metadata: {
        recipientUserId: transfer.recipient_user_id,
        transferId: transfer.transfer_id
      },
      reason: "transfer_credit_out",
      userId: transfer.sender_user_id
    }),
    publishTokenQuotaUpdate({
      actorUserId: auth.userId,
      deltaTokens: Number(transfer.amount_tokens),
      email: transfer.recipient_email,
      llmTokenQuota: Number(transfer.recipient_llm_token_quota),
      llmTokenUsed: Number(transfer.recipient_llm_token_used),
      openclawInstance: instanceByUserId.get(transfer.recipient_user_id) ?? null,
      metadata: {
        senderUserId: transfer.sender_user_id,
        transferId: transfer.transfer_id
      },
      reason: "transfer_credit_in",
      userId: transfer.recipient_user_id
    })
  ]);

  return NextResponse.json({
    transfer: {
      amountTokens: Number(transfer.amount_tokens),
      recipient: {
        displayName: transfer.recipient_display_name,
        email: transfer.recipient_email,
        userId: transfer.recipient_user_id
      },
      sender: {
        availableTokens: Number(transfer.sender_available_tokens),
        email: transfer.sender_email,
        llmTokenQuota: Number(transfer.sender_llm_token_quota),
        llmTokenUsed: Number(transfer.sender_llm_token_used),
        userId: transfer.sender_user_id
      },
      transferId: transfer.transfer_id
    }
  });
}
