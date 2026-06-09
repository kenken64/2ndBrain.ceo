"use client";

import { useState } from "react";
import { AiCreditTransfer } from "@/components/ai-credit-transfer";
import { SolanaCreditPurchase } from "@/components/solana-credit-purchase";

type AiCreditsPaymentPanelProps = {
  billingConfigured: boolean;
  initialQuota: number;
  initialUsed: number;
  packageTokens: number;
  packageUsdCents: number;
};

export function AiCreditsPaymentPanel({
  billingConfigured,
  initialQuota,
  initialUsed,
  packageTokens,
  packageUsdCents
}: AiCreditsPaymentPanelProps) {
  const [balance, setBalance] = useState({
    quota: initialQuota,
    used: initialUsed
  });

  return (
    <>
      <SolanaCreditPurchase
        balance={balance}
        billingConfigured={billingConfigured}
        onBalanceChange={setBalance}
        packageTokens={packageTokens}
        packageUsdCents={packageUsdCents}
      />
      <AiCreditTransfer balance={balance} onBalanceChange={setBalance} />
    </>
  );
}
