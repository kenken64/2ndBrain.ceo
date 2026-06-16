import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SolanaPaymentHistoryItem } from "@/types/solana-payment-history";

const LAMPORTS_PER_SOL = 1_000_000_000;
const PAYMENT_SELECT =
  "id,quote_id,user_id,wallet_address,signature,treasury_wallet,lamports_received,package_tokens,usd_amount_cents,sol_usd_price,transaction_block_time,status,created_at";

type SupabaseLike = Pick<SupabaseClient, "from">;

type WalletPaymentRow = {
  created_at: string | null;
  id: string;
  lamports_received: number | string | null;
  package_tokens: number | string | null;
  quote_id: string | null;
  signature: string;
  sol_usd_price: number | string | null;
  status: string | null;
  transaction_block_time: string | null;
  treasury_wallet: string;
  usd_amount_cents: number | string | null;
  user_id: string;
  wallet_address: string;
};

type PaymentQuoteNetworkRow = {
  id: string;
  solana_network: string | null;
};

export type SolanaPaymentProfile = {
  email: string | null;
  full_name: string | null;
  id: string;
};

function numericValue(value: number | string | null | undefined) {
  const number = Number(value ?? 0);

  return Number.isFinite(number) ? number : 0;
}

async function loadPaymentNetworks(supabase: SupabaseLike, rows: WalletPaymentRow[]) {
  const quoteIds = Array.from(
    new Set(rows.map((row) => row.quote_id).filter((quoteId): quoteId is string => Boolean(quoteId)))
  );

  if (quoteIds.length === 0) {
    return new Map<string, string>();
  }

  const { data, error } = await supabase
    .from("payment_quotes")
    .select("id,solana_network")
    .in("id", quoteIds)
    .limit(quoteIds.length);

  if (error) {
    console.error("[solana-payment-history] payment quote lookup failed", error);
    return new Map<string, string>();
  }

  return new Map(
    ((data ?? []) as PaymentQuoteNetworkRow[])
      .filter((row) => row.id && row.solana_network)
      .map((row) => [row.id, row.solana_network as string])
  );
}

function normalizePayments(
  rows: WalletPaymentRow[],
  networks: Map<string, string>,
  profiles: Map<string, SolanaPaymentProfile>
): SolanaPaymentHistoryItem[] {
  return rows.map((row) => {
    const lamportsReceived = numericValue(row.lamports_received);
    const profile = profiles.get(row.user_id);

    return {
      createdAt: row.created_at,
      id: row.id,
      lamportsReceived,
      packageTokens: numericValue(row.package_tokens),
      signature: row.signature,
      solAmount: lamportsReceived / LAMPORTS_PER_SOL,
      solUsdPrice: numericValue(row.sol_usd_price),
      solanaNetwork: row.quote_id ? networks.get(row.quote_id) ?? null : null,
      status: row.status ?? "confirmed",
      transactionBlockTime: row.transaction_block_time,
      treasuryWallet: row.treasury_wallet,
      usdAmountCents: numericValue(row.usd_amount_cents),
      userEmail: profile?.email ?? null,
      userId: row.user_id,
      userName: profile?.full_name ?? null,
      walletAddress: row.wallet_address
    };
  });
}

export async function getUserSolanaPaymentHistory(
  supabase: SupabaseLike,
  userId: string,
  profile: SolanaPaymentProfile | null,
  limit = 12
) {
  const { data, error } = await supabase
    .from("wallet_payments")
    .select(PAYMENT_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[solana-payment-history] user payment lookup failed", error);
    return [];
  }

  const rows = (data ?? []) as WalletPaymentRow[];
  const networks = await loadPaymentNetworks(supabase, rows);
  const profiles = profile ? new Map([[profile.id, profile]]) : new Map<string, SolanaPaymentProfile>();

  return normalizePayments(rows, networks, profiles);
}

export async function getAdminSolanaPaymentHistory(
  supabase: SupabaseLike,
  profiles: SolanaPaymentProfile[],
  limit = 30
) {
  const { data, error } = await supabase
    .from("wallet_payments")
    .select(PAYMENT_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[solana-payment-history] admin payment lookup failed", error);
    return [];
  }

  const rows = (data ?? []) as WalletPaymentRow[];
  const networks = await loadPaymentNetworks(supabase, rows);
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));

  return normalizePayments(rows, networks, profileMap);
}
