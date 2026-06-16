export type SolanaPaymentHistoryItem = {
  createdAt: string | null;
  id: string;
  lamportsReceived: number;
  packageTokens: number;
  signature: string;
  solAmount: number;
  solUsdPrice: number;
  solanaNetwork: string | null;
  status: string;
  transactionBlockTime: string | null;
  treasuryWallet: string;
  usdAmountCents: number;
  userEmail: string | null;
  userId: string;
  userName: string | null;
  walletAddress: string;
};
