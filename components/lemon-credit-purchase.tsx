"use client";

import { useEffect, useRef, useState } from "react";
import { CreditCard, LoaderCircle } from "lucide-react";
import { Localized, LocalizedMessage } from "@/components/language-provider";
import type { CreditOption } from "@/lib/credit-pricing";
import type { AiCreditBalance } from "@/components/ai-credits-payment-panel";

type LemonEvent = { event?: string };
declare global {
  interface Window {
    LemonSqueezy?: { Setup: (options: { eventHandler: (event: LemonEvent) => void }) => void; Url: { Open: (url: string) => void; Close: () => void } };
    createLemonSqueezy?: () => void;
  }
}
function loadLemonJs() {
  if (window.LemonSqueezy) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://app.lemonsqueezy.com/js/lemon.js"]');
    const script = existing ?? document.createElement("script");
    const timeout = window.setTimeout(() => reject(new Error("Card checkout could not be loaded.")), 12000);
    const finish = () => {
      window.clearTimeout(timeout);
      try { window.createLemonSqueezy?.(); window.LemonSqueezy ? resolve() : reject(new Error("Card checkout could not be loaded.")); }
      catch { reject(new Error("Card checkout could not be loaded.")); }
    };
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => { window.clearTimeout(timeout); script.remove(); reject(new Error("Card checkout could not be loaded.")); }, { once: true });
    if (!existing) { script.src = "https://app.lemonsqueezy.com/js/lemon.js"; script.async = true; document.head.appendChild(script); }
  });
}

type Props = { selection?: CreditOption | null; onActivityChange?: (busy: boolean) => void; onPriceChanged?: () => void; configured: boolean; testMode: boolean; packageTokens: number; packageUsdCents: number; onBalanceChange: (balance: AiCreditBalance) => void; onPaymentConfirmed?: () => void };
export function LemonCreditPurchase({ selection, onActivityChange, onPriceChanged, configured, testMode, packageTokens, packageUsdCents, onBalanceChange, onPaymentConfirmed }: Props) {
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const balanceCallback = useRef(onBalanceChange), confirmedCallback = useRef(onPaymentConfirmed);
  balanceCallback.current = onBalanceChange; confirmedCallback.current = onPaymentConfirmed;
  useEffect(() => {
    if (!intent) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const poll = async () => {
      try {
        const response = await fetch(`/api/billing/lemon/status?intent=${encodeURIComponent(intent)}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json() as { status?: string; balance?: AiCreditBalance };
        if (response.ok && result.status && result.status !== "pending") {
          if (result.balance) balanceCallback.current(result.balance);
          setMessage(result.status === "paid" ? "Your card payment is confirmed and AI credits have been added." : "This payment was refunded. Your AI credits have been adjusted.");
          setIntent(null); onActivityChange?.(false); confirmedCallback.current?.(); return;
        }
      } catch { /* Webhooks can arrive later; keep checking. */ }
      if (!controller.signal.aborted && Date.now() - started < 120_000) timer = setTimeout(poll, 3000);
      else if (!controller.signal.aborted) { setMessage("If you paid, your credits will appear after payment confirmation. Check your balance before starting another purchase."); setIntent(null); onActivityChange?.(false); }
    };
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [intent]);

  async function startCheckout() {
    if (busy || intent) return;
    setBusy(true); onActivityChange?.(true); setError(""); setMessage("");
    let checkoutOpened = false;
    try {
      await loadLemonJs();
      const response = await fetch("/api/billing/lemon/checkout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selection ? { sgdCents: selection.sgdCents, expectedUsdCents: selection.usdCents } : {}) });
      if (response.status === 409) onPriceChanged?.();
      const result = await response.json() as { intentId?: string; url?: string; error?: string };
      if (!response.ok || !result.intentId || !result.url || !window.LemonSqueezy) throw new Error(result.error ?? "Card checkout could not be started.");
      window.LemonSqueezy.Setup({ eventHandler: event => { if (event.event === "Checkout.Success") setMessage("Payment received. Waiting for confirmation before adding credits."); } });
      setIntent(result.intentId);
      setMessage("Complete your payment in the checkout. Credits are added after confirmation.");
      window.LemonSqueezy.Url.Open(result.url);
      checkoutOpened = true;
    } catch (reason) { setIntent(null); setError(reason instanceof Error ? reason.message : "Card checkout could not be started."); }
    finally { setBusy(false); if (!checkoutOpened) onActivityChange?.(false); }
  }
  return <article className="settings-action-card">
    <div><p className="workspace-status-card__eyebrow"><Localized en="Credit card" zh="信用卡" /></p>
      <h2><Localized en="Pay by card" zh="使用银行卡支付" /></h2>
      <p><Localized en={`${new Intl.NumberFormat("en").format(packageTokens)} AI credits for $${(packageUsdCents / 100).toFixed(2)} USD, plus any applicable taxes. Secure checkout by Lemon Squeezy.`} zh={`${new Intl.NumberFormat("en").format(packageTokens)} AI 积分，价格为 $${(packageUsdCents / 100).toFixed(2)} 美元，另加适用税费。由 Lemon Squeezy 提供安全结账。`} /></p>
      {testMode && configured ? <p><Localized en="Test checkout: use test payment details only." zh="测试结账：请仅使用测试付款信息。" /></p> : null}
      {!configured ? <p><Localized en="Card payment is not available yet." zh="银行卡支付暂不可用。" /></p> : null}
      {message ? <p className="form-success" role="status"><Localized en={message} zh={message === "Your card payment is confirmed and AI credits have been added." ? "银行卡付款已确认，AI 积分已到账。" : message === "Payment received. Waiting for confirmation before adding credits." ? "已收到付款，正在等待确认后添加积分。" : message === "This payment was refunded. Your AI credits have been adjusted." ? "此付款已退款，AI 积分已调整。" : message === "If you paid, your credits will appear after payment confirmation. Check your balance before starting another purchase." ? "如果您已付款，积分将在付款确认后到账。开始另一次购买前请先检查余额。" : "请在结账窗口完成付款，确认后积分将到账。"} /></p> : null}
      {error ? <p className="form-error" role="alert"><LocalizedMessage text={error} /></p> : null}
    </div>
    <div><button className="settings-action-button" type="button" disabled={!configured || busy || Boolean(intent)} onClick={() => void startCheckout()}>{busy || intent ? <LoaderCircle size={18} /> : <CreditCard size={18} />} {busy ? <Localized en="Opening checkout…" zh="正在打开结账…" /> : intent ? <Localized en="Waiting for confirmation…" zh="正在等待确认…" /> : <Localized en="Pay with card" zh="使用银行卡支付" />}</button>
    {intent ? <button className="btn-ghost" type="button" onClick={() => { window.LemonSqueezy?.Url.Close(); setIntent(null); onActivityChange?.(false); setMessage("If you paid, your credits will appear after payment confirmation. Check your balance before starting another purchase."); }}><Localized en="Close checkout" zh="关闭结账" /></button> : null}</div>
  </article>;
}
