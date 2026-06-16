"use client";

import { useState } from "react";
import { AiCreditTransfer } from "@/components/ai-credit-transfer";
import { SolanaPaymentHistory } from "@/components/solana-payment-history";
import { SolanaCreditPurchase } from "@/components/solana-credit-purchase";
import type { SolanaPaymentHistoryItem } from "@/types/solana-payment-history";

export type AiCreditBalance = {
  quota: number;
  used: number;
};

type AiCreditsPaymentPanelProps = {
  balance?: AiCreditBalance;
  billingConfigured: boolean;
  initialQuota: number;
  initialUsed: number;
  onBalanceChange?: (balance: AiCreditBalance) => void;
  onPaymentConfirmed?: () => void;
  packageTokens: number;
  packageUsdCents: number;
  paymentHistory?: SolanaPaymentHistoryItem[];
};

export function AiCreditsPaymentPanel({
  balance,
  billingConfigured,
  initialQuota,
  initialUsed,
  onBalanceChange,
  onPaymentConfirmed,
  packageTokens,
  packageUsdCents,
  paymentHistory = []
}: AiCreditsPaymentPanelProps) {
  const [internalBalance, setInternalBalance] = useState({
    quota: initialQuota,
    used: initialUsed
  });
  const activeBalance = balance ?? internalBalance;

  function updateBalance(nextBalance: AiCreditBalance) {
    setInternalBalance(nextBalance);
    onBalanceChange?.(nextBalance);
  }

  return (
    <>
      <SolanaCreditPurchase
        balance={activeBalance}
        billingConfigured={billingConfigured}
        onBalanceChange={updateBalance}
        onPaymentConfirmed={onPaymentConfirmed}
        packageTokens={packageTokens}
        packageUsdCents={packageUsdCents}
      />
      <SolanaPaymentHistory payments={paymentHistory} />
      <AiCreditTransfer balance={activeBalance} onBalanceChange={updateBalance} />
    </>
  );
}
