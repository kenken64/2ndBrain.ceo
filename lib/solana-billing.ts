import "server-only";

import { clusterApiUrl, Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const BINANCE_SOL_PRICE_URL = "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT";
const SUPPORTED_SOLANA_NETWORKS = ["mainnet-beta", "devnet", "testnet"] as const;
const DEFAULT_SOLANA_NETWORK: SupportedSolanaNetwork = "devnet";

export const AI_CREDIT_PACKAGE_TOKENS = 7_500_000;
export const AI_CREDIT_PACKAGE_USD_CENTS = 3_000;
export const AI_CREDIT_PACKAGE_LABEL = "7.5M AI credits";
export const SOLANA_QUOTE_TTL_MS = 5 * 60 * 1000;

type SupportedSolanaNetwork = (typeof SUPPORTED_SOLANA_NETWORKS)[number];

function cleanEnvValue(value: string | undefined) {
  const cleaned = value?.trim().replace(/^['"]|['"]$/g, "");
  return cleaned || null;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isSupportedSolanaNetwork(value: string | null): value is SupportedSolanaNetwork {
  return SUPPORTED_SOLANA_NETWORKS.includes(value as SupportedSolanaNetwork);
}

export function getSolanaTreasuryWallet() {
  const wallet = cleanEnvValue(process.env.SOLANA_TREASURY_WALLET);

  if (!wallet) {
    return null;
  }

  try {
    return new PublicKey(wallet).toBase58();
  } catch {
    return null;
  }
}

export function hasSolanaBillingEnv() {
  return Boolean(getSolanaTreasuryWallet());
}

export function getSolanaRpcUrl() {
  return cleanEnvValue(process.env.SOLANA_RPC_URL) ?? clusterApiUrl(getSolanaNetworkName());
}

export function getSolanaNetworkName() {
  const network = cleanEnvValue(process.env.SOLANA_PAYMENT_NETWORK);

  return isSupportedSolanaNetwork(network) ? network : DEFAULT_SOLANA_NETWORK;
}

export function getSolanaQuoteTtlMs() {
  return readPositiveInteger(process.env.SOLANA_QUOTE_TTL_MS, SOLANA_QUOTE_TTL_MS);
}

export function createSolanaConnection() {
  return new Connection(getSolanaRpcUrl(), "confirmed");
}

export function lamportsToSol(lamports: number) {
  return lamports / LAMPORTS_PER_SOL;
}

export function usdCentsToDollars(cents: number) {
  return cents / 100;
}

export async function fetchSolUsdPrice() {
  const response = await fetch(BINANCE_SOL_PRICE_URL, {
    cache: "no-store",
    headers: {
      "User-Agent": "2ndBrain.ceo billing"
    }
  });

  if (!response.ok) {
    throw new Error("binance_price_unavailable");
  }

  const payload = (await response.json().catch(() => null)) as { price?: unknown; symbol?: unknown } | null;
  const price = Number(payload?.price);

  if (payload?.symbol !== "SOLUSDT" || !Number.isFinite(price) || price <= 0) {
    throw new Error("binance_price_invalid");
  }

  return price;
}

export function solPriceToLamports(usdCents: number, solUsdPrice: number) {
  const usdAmount = usdCentsToDollars(usdCents);
  const solAmount = usdAmount / solUsdPrice;

  return Math.ceil(solAmount * LAMPORTS_PER_SOL);
}
