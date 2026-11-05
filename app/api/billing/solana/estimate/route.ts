import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { resolveCreditOption } from "@/lib/credit-pricing-server";
import { getUserIdFromClaims } from "@/lib/onboarding";
import {
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

export async function GET(request: Request) {
  const auth = await requireUser();

  if (auth.response) {
    return auth.response;
  }

  if (!getSolanaTreasuryWallet()) {
    return NextResponse.json({ error: "SOLANA_TREASURY_WALLET is required for Solana billing" }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;
  const rawSgd = params.get("sgdCents"), rawUsd = params.get("expectedUsdCents");
  let selection: Awaited<ReturnType<typeof resolveCreditOption>>;
  try { selection = await resolveCreditOption(rawSgd === null ? null : Number(rawSgd), rawUsd === null ? null : Number(rawUsd)); }
  catch (reason) {
    const code = reason instanceof Error ? reason.message : "exchange_rates_unavailable";
    return NextResponse.json({ error: code === "credit_price_changed" ? "Exchange rates changed. Refresh your top-up options." : code === "invalid_credit_option" ? "Choose a valid top-up amount." : "Exchange rates are temporarily unavailable. Please try again." }, { status: code === "credit_price_changed" ? 409 : code === "invalid_credit_option" ? 400 : 503 });
  }

  try {
    const solUsdPrice = await fetchSolUsdPrice();
    const solAmountLamports = solPriceToLamports(selection.usdCents, solUsdPrice);

    return NextResponse.json({
      estimate: {
        packageTokens: selection.credits,
        solAmount: lamportsToSol(solAmountLamports),
        solAmountLamports,
        solUsdPrice,
        solanaNetwork: getSolanaNetworkName(),
        usdAmount: usdCentsToDollars(selection.usdCents),
        usdAmountCents: selection.usdCents
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "solana_estimate_failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
