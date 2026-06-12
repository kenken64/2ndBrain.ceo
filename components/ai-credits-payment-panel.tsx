"use client";

import { useState } from "react";
import { AiCreditTransfer } from "@/components/ai-credit-transfer";
import { SolanaCreditPurchase } from "@/components/solana-credit-purchase";

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
  packageTokens: number;
  packageUsdCents: number;
};

export function AiCreditsPaymentPanel({
  balance,
  billingConfigured,
  initialQuota,
  initialUsed,
  onBalanceChange,
  packageTokens,
  packageUsdCents
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
        packageTokens={packageTokens}
        packageUsdCents={packageUsdCents}
      />
      <AiCreditTransfer balance={activeBalance} onBalanceChange={updateBalance} />
    </>
  );
}
