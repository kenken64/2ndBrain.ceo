import { NextResponse } from "next/server";
import {
  PublicKey,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
  type PartiallyDecodedInstruction
} from "@solana/web3.js";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createSolanaConnection } from "@/lib/solana-billing";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { publishTokenQuotaUpdate } from "@/lib/token-quota-redis";

export const runtime = "nodejs";

const CONFIRMATION_POLL_ATTEMPTS = 8;
const CONFIRMATION_POLL_DELAY_MS = 1500;
const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/;

type PaymentQuoteRow = {
  expires_at: string;
  id: string;
  package_tokens: number | string;
  signature: string | null;
  sol_amount_lamports: number | string;
  status: string;
  treasury_wallet: string;
  user_id: string;
  wallet_address: string;
};

type AppliedCreditRow = {
  added_tokens: number | string;
  new_llm_token_quota: number | string;
  payment_id: string;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWallet(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return new PublicKey(value.trim()).toBase58();
  } catch {
    return null;
  }
}

function normalizeSignature(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const signature = value.trim();

  return SIGNATURE_PATTERN.test(signature) ? signature : null;
}

function isParsedInstruction(
  instruction: ParsedInstruction | PartiallyDecodedInstruction
): instruction is ParsedInstruction {
  return "parsed" in instruction;
}

function parsedTransferLamports(
  transaction: ParsedTransactionWithMeta,
  walletAddress: string,
  treasuryWallet: string
) {
  let lamportsReceived = 0;

  for (const instruction of transaction.transaction.message.instructions) {
    if (!isParsedInstruction(instruction) || instruction.program !== "system") {
      continue;
    }

    const parsed = instruction.parsed as {
      info?: {
        destination?: unknown;
        lamports?: unknown;
        source?: unknown;
      };
      type?: string;
    };

    if (parsed.type !== "transfer") {
      continue;
    }

    const source = typeof parsed.info?.source === "string" ? parsed.info.source : "";
    const destination = typeof parsed.info?.destination === "string" ? parsed.info.destination : "";
    const lamports = Number(parsed.info?.lamports ?? 0);

    if (
      source === walletAddress &&
      destination === treasuryWallet &&
      Number.isSafeInteger(lamports) &&
      lamports > 0
    ) {
      lamportsReceived += lamports;
    }
  }

  return lamportsReceived;
}

function transactionWasSignedBy(transaction: ParsedTransactionWithMeta, walletAddress: string) {
  return transaction.transaction.message.accountKeys.some(
    (account) => account.signer && account.pubkey.toBase58() === walletAddress
  );
}

async function waitForParsedTransaction(signature: string) {
  const connection = createSolanaConnection();

  for (let attempt = 0; attempt < CONFIRMATION_POLL_ATTEMPTS; attempt += 1) {
    const transaction = await connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });

    if (transaction) {
      return transaction;
    }

    await delay(CONFIRMATION_POLL_DELAY_MS);
  }

  return null;
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
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required for billing" }, { status: 503 });
  }

  const payload = (await request.json().catch(() => null)) as {
    quoteId?: unknown;
    signature?: unknown;
    walletAddress?: unknown;
  } | null;
  const quoteId = typeof payload?.quoteId === "string" ? payload.quoteId.trim() : "";
  const signature = normalizeSignature(payload?.signature);
  const walletAddress = normalizeWallet(payload?.walletAddress);

  if (!quoteId || !signature || !walletAddress) {
    return NextResponse.json({ error: "quoteId, signature, and walletAddress are required" }, { status: 400 });
  }

  const adminSupabase = createAdminClient();
  const { data: quoteData, error: quoteError } = await adminSupabase
    .from("payment_quotes")
    .select("id,user_id,wallet_address,package_tokens,sol_amount_lamports,treasury_wallet,status,signature,expires_at")
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError) {
    return NextResponse.json({ error: quoteError.message }, { status: 500 });
  }

  const quote = quoteData as PaymentQuoteRow | null;

  if (!quote || quote.user_id !== auth.userId) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  if (quote.wallet_address !== walletAddress) {
    return NextResponse.json({ error: "Wallet does not match quote" }, { status: 409 });
  }

  if (quote.status === "paid" && quote.signature === signature) {
    const { data: profile } = await adminSupabase
      .from("profiles")
      .select("llm_token_quota,llm_token_used")
      .eq("id", auth.userId)
      .maybeSingle();

    return NextResponse.json({
      credit: {
        addedTokens: Number(quote.package_tokens),
        llmTokenQuota: Number(profile?.llm_token_quota ?? 0),
        llmTokenUsed: Number(profile?.llm_token_used ?? 0)
      },
      ok: true
    });
  }

  if (quote.status !== "pending") {
    return NextResponse.json({ error: "Quote is no longer pending" }, { status: 409 });
  }

  const transaction = await waitForParsedTransaction(signature);

  if (!transaction) {
    return NextResponse.json({ error: "Transaction is not confirmed yet" }, { status: 409 });
  }

  if (transaction.meta?.err) {
    return NextResponse.json({ error: "Transaction failed on Solana" }, { status: 409 });
  }

  if (!transactionWasSignedBy(transaction, walletAddress)) {
    return NextResponse.json({ error: "Transaction was not signed by the quoted wallet" }, { status: 409 });
  }

  const lamportsReceived = parsedTransferLamports(transaction, walletAddress, quote.treasury_wallet);
  const requiredLamports = Number(quote.sol_amount_lamports);

  if (lamportsReceived < requiredLamports) {
    return NextResponse.json({ error: "Solana payment amount is lower than the quote" }, { status: 409 });
  }

  const transactionBlockTime = transaction.blockTime
    ? new Date(transaction.blockTime * 1000).toISOString()
    : null;
  const { data: appliedData, error: appliedError } = await adminSupabase
    .rpc("apply_solana_credit_purchase", {
      p_lamports_received: lamportsReceived,
      p_quote_id: quote.id,
      p_signature: signature,
      p_transaction_block_time: transactionBlockTime,
      p_transaction_payload: {
        blockTime: transaction.blockTime,
        lamportsReceived,
        quoteId: quote.id,
        signature,
        slot: transaction.slot,
        treasuryWallet: quote.treasury_wallet,
        walletAddress
      },
      p_treasury_wallet: quote.treasury_wallet,
      p_user_id: auth.userId,
      p_wallet_address: walletAddress
    })
    .single();

  if (appliedError) {
    return NextResponse.json({ error: appliedError.message }, { status: 409 });
  }

  const applied = appliedData as AppliedCreditRow;
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("email,llm_token_used")
    .eq("id", auth.userId)
    .maybeSingle();
  const llmTokenQuota = Number(applied.new_llm_token_quota);
  const llmTokenUsed = Number(profile?.llm_token_used ?? 0);

  await publishTokenQuotaUpdate({
    actorUserId: auth.userId,
    deltaTokens: Number(applied.added_tokens),
    email: profile?.email ?? null,
    llmTokenQuota,
    llmTokenUsed,
    metadata: {
      paymentId: applied.payment_id,
      quoteId: quote.id,
      signature
    },
    reason: "solana_credit_purchase",
    userId: auth.userId
  });

  return NextResponse.json({
    credit: {
      addedTokens: Number(applied.added_tokens),
      llmTokenQuota,
      llmTokenUsed,
      paymentId: applied.payment_id
    },
    ok: true
  });
}
