"use client";

import { useCallback, useEffect, useState } from "react";
import { AudioLines, CreditCard, FileText, Image as ImageIcon, ReceiptText, Video, Wallet } from "lucide-react";
import { Localized, useLanguage } from "@/components/language-provider";
import { LemonPaymentHistory } from "@/components/lemon-payment-history";
import { LemonCreditPurchase } from "@/components/lemon-credit-purchase";
import { ChatSavedFiles } from "@/components/chat-saved-files";
import { ChatUsageButton } from "@/components/chat-usage-button";
import { AiCreditTransfer } from "@/components/ai-credit-transfer";
import { SolanaPaymentHistory } from "@/components/solana-payment-history";
import { SolanaCreditPurchase } from "@/components/solana-credit-purchase";
import type { CreditOptions } from "@/lib/credit-pricing";
import type { SolanaPaymentHistoryItem } from "@/types/solana-payment-history";

export type AiCreditBalance = { quota: number; used: number };
type AiCreditsPaymentPanelProps = {
  balance?: AiCreditBalance;
  billingConfigured: boolean;
  cardBillingConfigured: boolean;
  cardTestMode: boolean;
  initialQuota: number;
  initialUsed: number;
  onBalanceChange?: (balance: AiCreditBalance) => void;
  onPaymentConfirmed?: () => void;
  packageTokens: number;
  packageUsdCents: number;
  paymentHistory?: SolanaPaymentHistoryItem[];
};

export function AiCreditsPaymentPanel({ balance, billingConfigured, cardBillingConfigured, cardTestMode, initialQuota, initialUsed, onBalanceChange, onPaymentConfirmed, packageTokens, packageUsdCents, paymentHistory = [] }: AiCreditsPaymentPanelProps) {
  const zh = useLanguage().language === "zh";
  const [internalBalance, setInternalBalance] = useState({ quota: initialQuota, used: initialUsed });
  const [cardHistoryVersion, setCardHistoryVersion] = useState(0);
  const [currency, setCurrency] = useState<"SGD" | "CNY">("SGD");
  const [selectedCents, setSelectedCents] = useState(3000);
  const [method, setMethod] = useState<"card" | "solana">(cardBillingConfigured ? "card" : "solana");
  const [activityBusy, setActivityBusy] = useState(false);
  const [options, setOptions] = useState<CreditOptions | null>(null);
  const [optionsError, setOptionsError] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const activeBalance = balance ?? internalBalance;
  const selected = options?.options.find(item => item.sgdCents === selectedCents) ?? null;
  const refreshPrices = useCallback(() => { setOptions(null); setRefreshCount(value => value + 1); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setOptionsError(false);
    fetch("/api/billing/options", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("pricing unavailable");
      const data = await response.json() as CreditOptions;
      if (!Array.isArray(data.options) || data.options.length !== 6 || !data.options.every(item => Number.isSafeInteger(item.sgdCents) && Number.isSafeInteger(item.usdCents) && Number.isSafeInteger(item.cnyCents) && Number.isSafeInteger(item.credits))) throw new Error("pricing unavailable");
      if (!controller.signal.aborted) setOptions(data);
    }).catch(() => { if (!controller.signal.aborted) setOptionsError(true); });
    return () => controller.abort();
  }, [refreshCount]);
  function updateBalance(nextBalance: AiCreditBalance) { setInternalBalance(nextBalance); onBalanceChange?.(nextBalance); }
  const number = (value: number) => value.toLocaleString("en");
  const amount = (value: number) => currency === "SGD" ? `S$${(value / 100).toFixed(value % 100 ? 2 : 0)}` : `¥${(value / 100).toFixed(2)}`;
  const categories = [
    { icon: FileText, title: zh ? "文字" : "Text", text: zh ? "对话、文件和创意" : "Chat, documents and ideas" },
    { icon: ImageIcon, title: zh ? "图片" : "Image", text: zh ? "创建和理解图片" : "Create and understand images" },
    { icon: AudioLines, title: zh ? "语音" : "Voice", text: zh ? "即将推出" : "Coming soon" },
    { icon: Video, title: zh ? "视频" : "Video", text: zh ? "根据提示创建视频" : "Create videos from prompts" }
  ];
  return <div className="topup-page">
    <div className="topup-header"><div><p className="workspace-status-card__eyebrow"><Localized en="AI CREDITS" zh="AI 积分" /></p><h2><Localized en="Top up your AI credits" zh="充值 AI 积分" /></h2><p><Localized en="One balance for the ways you create." zh="一个积分余额，支持多种创作方式。" /></p></div><div className="topup-header__actions"><ChatUsageButton /><a className="btn-ghost" href="#topup-history"><ReceiptText size={16} /> <Localized en="Payment history" zh="付款记录" /></a></div></div>
    <div className="topup-balance"><span><Localized en="Available credits" zh="可用积分" /></span><strong>{number(Math.max(0, activeBalance.quota - activeBalance.used))}</strong></div>
    <section className="topup-card" aria-labelledby="topup-amount-title">
      <div className="topup-card__heading"><div><h3 id="topup-amount-title"><Localized en="Select an amount" zh="选择充值金额" /></h3><p><Localized en="Your credits are based on the USD charge." zh="积分根据美元付款金额计算。" /></p></div><div className="topup-currency" role="group" aria-label={zh ? "显示货币" : "Display currency"}><button type="button" aria-pressed={currency === "SGD"} onClick={() => setCurrency("SGD")}><Localized en="SGD" zh="新元" /></button><button type="button" aria-pressed={currency === "CNY"} onClick={() => setCurrency("CNY")}><Localized en="CNY" zh="人民币" /></button></div></div>
      {optionsError ? <p className="form-error" role="alert"><Localized en="Exchange rates are temporarily unavailable." zh="汇率暂时不可用。" /> <button type="button" className="text-link" onClick={refreshPrices}><Localized en="Try again" zh="重试" /></button></p> : null}
      {!options && !optionsError ? <p role="status"><Localized en="Loading current exchange rates…" zh="正在加载最新汇率…" /></p> : null}
      {options ? <><div className="topup-options" role="radiogroup" aria-label={zh ? "充值金额" : "Top-up amount"}>{options.options.map(item => <button key={item.sgdCents} type="button" role="radio" aria-checked={item.sgdCents === selectedCents} disabled={activityBusy} className={item.sgdCents === selectedCents ? "is-selected" : ""} onClick={() => setSelectedCents(item.sgdCents)}><strong>{currency === "CNY" ? "≈ " : ""}{amount(currency === "SGD" ? item.sgdCents : item.cnyCents)}</strong><small>{number(item.credits)} {zh ? "积分" : "credits"}</small></button>)}</div>
        <p className="topup-note">{zh ? `汇率参考日期：${options.rateDate}。新元和人民币金额为估算值；实际以美元或 Solana 结算，付款时汇率及税费可能不同。` : `Reference rates: ${options.rateDate}. SGD and CNY amounts are estimates; checkout is charged in USD or Solana and exchange rates and taxes may vary.`}</p></> : null}
      <div className="topup-divider" />
      <h3><Localized en="Payment method" zh="付款方式" /></h3>
      <div className="topup-methods" role="radiogroup" aria-label={zh ? "付款方式" : "Payment method"}>
        <button type="button" role="radio" aria-checked={method === "card"} className={method === "card" ? "is-selected" : ""} disabled={activityBusy} onClick={() => setMethod("card")}><CreditCard size={20} /><span><Localized en="Card & more" zh="银行卡等" /></span></button>
        <button type="button" role="radio" aria-checked={method === "solana"} className={method === "solana" ? "is-selected" : ""} disabled={activityBusy} onClick={() => setMethod("solana")}><Wallet size={20} /><span><Localized en="Solana · Phantom" zh="Solana · Phantom" /></span></button>
      </div>
      {selected ? <div className="topup-summary"><span><Localized en="Credits added" zh="到账积分" /> <strong>{number(selected.credits)}</strong></span><span><Localized en="USD amount" zh="美元金额" /> <strong>${(selected.usdCents / 100).toFixed(2)}</strong></span></div> : null}
      <div className="topup-checkout">{method === "card" ? <LemonCreditPurchase key={`card-${selected?.sgdCents}-${selected?.usdCents}`} selection={selected} onActivityChange={setActivityBusy} onPriceChanged={refreshPrices} configured={cardBillingConfigured && Boolean(selected)} testMode={cardTestMode} packageTokens={selected?.credits ?? packageTokens} packageUsdCents={selected?.usdCents ?? packageUsdCents} onBalanceChange={updateBalance} onPaymentConfirmed={() => { setCardHistoryVersion(current => current + 1); onPaymentConfirmed?.(); }} /> : <SolanaCreditPurchase key={`solana-${selected?.sgdCents}-${selected?.usdCents}`} selection={selected} onActivityChange={setActivityBusy} onPriceChanged={refreshPrices} balance={activeBalance} billingConfigured={billingConfigured && Boolean(selected)} packageTokens={selected?.credits ?? packageTokens} packageUsdCents={selected?.usdCents ?? packageUsdCents} onBalanceChange={updateBalance} onPaymentConfirmed={onPaymentConfirmed} />}</div>
    </section>
    <section className="topup-categories" aria-labelledby="topup-categories-title"><h3 id="topup-categories-title"><Localized en="Create in more ways" zh="探索更多创作方式" /></h3><p><Localized en="Use your credits across supported AI features. No model selection needed here." zh="在支持的 AI 功能中使用积分，无需在此选择模型。" /></p><div className="topup-categories__grid">{categories.map(({ icon: Icon, title, text }) => <article key={title}><Icon size={22} /><strong>{title}</strong><span>{text}</span></article>)}</div></section>
    <section id="topup-history" className="topup-history"><SolanaPaymentHistory payments={paymentHistory} /><LemonPaymentHistory refreshKey={cardHistoryVersion} /></section>
    <article className="settings-action-card"><h2><Localized en="Saved chat files" zh="已保存的对话文件" /></h2><p><Localized en="Download files you saved from AI Chat." zh="下载您从 AI 对话保存的文件。" /></p><ChatSavedFiles disabled={false} /></article>
    <AiCreditTransfer balance={activeBalance} onBalanceChange={updateBalance} />
  </div>;
}
