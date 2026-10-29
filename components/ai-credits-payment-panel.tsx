"use client";

import { Localized } from "@/components/language-provider";


import { useState } from "react";
import { ChatSavedFiles } from "@/components/chat-saved-files";
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
      <article className="settings-action-card"><h2><Localized en={"Saved chat files"} zh={"已保存的对话文件"} /></h2><p><Localized en={"Download files you saved from AI Chat."} zh={"下载您从 AI 对话保存的文件。"} /></p><ChatSavedFiles disabled={false} /></article>
      <SolanaPaymentHistory payments={paymentHistory} />
      <AiCreditTransfer balance={activeBalance} onBalanceChange={updateBalance} />
    </>
  );
}
