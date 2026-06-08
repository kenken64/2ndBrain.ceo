import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createSolanaConnection, getSolanaNetworkName } from "@/lib/solana-billing";
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

  try {
    const blockhash = await createSolanaConnection().getLatestBlockhash("confirmed");

    return NextResponse.json({
      blockhash: {
        blockhash: blockhash.blockhash,
        lastValidBlockHeight: blockhash.lastValidBlockHeight,
        solanaNetwork: getSolanaNetworkName()
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "solana_blockhash_unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
