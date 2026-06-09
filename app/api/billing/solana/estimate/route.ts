import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import {
  AI_CREDIT_PACKAGE_TOKENS,
  AI_CREDIT_PACKAGE_USD_CENTS,
  fetchSolUsdPrice,
  getSolanaNetworkName,
  getSolanaTreasuryWallet,
  lamportsToSol,
  solPriceToLamports,
  usdCentsToDollars
} from "@/lib/solana-billing";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

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
    response: null
  };
}

export async function GET() {
  const auth = await requireUser();

  if (auth.response) {
    return auth.response;
  }

  if (!getSolanaTreasuryWallet()) {
    return NextResponse.json({ error: "SOLANA_TREASURY_WALLET is required for Solana billing" }, { status: 503 });
  }

  try {
    const solUsdPrice = await fetchSolUsdPrice();
    const solAmountLamports = solPriceToLamports(AI_CREDIT_PACKAGE_USD_CENTS, solUsdPrice);

    return NextResponse.json({
      estimate: {
        packageTokens: AI_CREDIT_PACKAGE_TOKENS,
        solAmount: lamportsToSol(solAmountLamports),
        solAmountLamports,
        solUsdPrice,
        solanaNetwork: getSolanaNetworkName(),
        usdAmount: usdCentsToDollars(AI_CREDIT_PACKAGE_USD_CENTS),
        usdAmountCents: AI_CREDIT_PACKAGE_USD_CENTS
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "solana_estimate_failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
