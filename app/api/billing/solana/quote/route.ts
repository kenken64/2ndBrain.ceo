import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { hasSupabaseEnv } from "@/lib/env";
import { resolveCreditOption } from "@/lib/credit-pricing-server";
import { getUserIdFromClaims } from "@/lib/onboarding";
import {
  createSolanaConnection,
  fetchSolUsdPrice,
  getSolanaNetworkName,
  getSolanaQuoteTtlMs,
  getSolanaTreasuryWallet,
  lamportsToSol,
  solPriceToLamports,
  usdCentsToDollars
} from "@/lib/solana-billing";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

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

  const treasuryWallet = getSolanaTreasuryWallet();

  if (!treasuryWallet) {
    return NextResponse.json({ error: "SOLANA_TREASURY_WALLET is required for Solana billing" }, { status: 503 });
  }

  const payload = (await request.json().catch(() => null)) as { walletAddress?: unknown; sgdCents?: unknown; expectedUsdCents?: unknown } | null;
  const walletAddress = normalizeWallet(payload?.walletAddress);

  if (!walletAddress) {
    return NextResponse.json({ error: "A valid Phantom Solana wallet address is required" }, { status: 400 });
  }

  let selection: Awaited<ReturnType<typeof resolveCreditOption>>;
  try { selection = await resolveCreditOption(payload?.sgdCents, payload?.expectedUsdCents); }
  catch (reason) {
    const code = reason instanceof Error ? reason.message : "exchange_rates_unavailable";
    return NextResponse.json({ error: code === "credit_price_changed" ? "Exchange rates changed. Refresh your top-up options." : code === "invalid_credit_option" ? "Choose a valid top-up amount." : "Exchange rates are temporarily unavailable. Please try again." }, { status: code === "credit_price_changed" ? 409 : code === "invalid_credit_option" ? 400 : 503 });
  }

  try {
    const [solUsdPrice, blockhash] = await Promise.all([
      fetchSolUsdPrice(),
      createSolanaConnection().getLatestBlockhash("confirmed")
    ]);
    const solAmountLamports = solPriceToLamports(selection.usdCents, solUsdPrice);
    const expiresAt = new Date(Date.now() + getSolanaQuoteTtlMs()).toISOString();
    const adminSupabase = createAdminClient();
    const { data, error } = await adminSupabase
      .from("payment_quotes")
      .insert({
        binance_symbol: "SOLUSDT",
        blockhash: blockhash.blockhash,
        expires_at: expiresAt,
        last_valid_block_height: blockhash.lastValidBlockHeight,
        package_tokens: selection.credits,
        sol_amount_lamports: solAmountLamports,
        sol_usd_price: solUsdPrice,
        solana_network: getSolanaNetworkName(),
        treasury_wallet: treasuryWallet,
        usd_amount_cents: selection.usdCents,
        user_id: auth.userId,
        wallet_address: walletAddress
      })
      .select("id,created_at,expires_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      quote: {
        blockhash: blockhash.blockhash,
        createdAt: data.created_at,
        expiresAt: data.expires_at,
        id: data.id,
        label: `${selection.credits.toLocaleString("en")} AI credits`,
        lastValidBlockHeight: blockhash.lastValidBlockHeight,
        packageTokens: selection.credits,
        solAmount: lamportsToSol(solAmountLamports),
        solAmountLamports,
        solUsdPrice,
        solanaNetwork: getSolanaNetworkName(),
        treasuryWallet,
        usdAmount: usdCentsToDollars(selection.usdCents),
        usdAmountCents: selection.usdCents,
        walletAddress
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "solana_quote_failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
