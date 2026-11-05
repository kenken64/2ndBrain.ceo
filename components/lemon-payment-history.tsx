"use client";
import { useEffect, useState } from "react";
import { Localized, useLanguage } from "@/components/language-provider";

type Payment = { id: string; order_id: string; status: string; credited_tokens: number | string; currency: "USD" | "SGD"; total_currency_cents: number | string | null; total_usd_cents: number | string; refunded_usd_cents: number | string; test_mode: boolean; created_at: string };
export function LemonPaymentHistory({ refreshKey }: { refreshKey: number }) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [failed, setFailed] = useState(false);
  const zh = useLanguage().language === "zh";
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/billing/lemon/history", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("history unavailable");
      const result = await response.json() as { payments?: Payment[] };
      if (!controller.signal.aborted) { setPayments(Array.isArray(result.payments) ? result.payments : []); setFailed(false); }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [refreshKey]);
  if (!payments.length && !failed) return null;
  return <article className="settings-action-card"><div><h2><Localized en="Card payment history" zh="银行卡付款记录" /></h2>
    {failed ? <p><Localized en="Card payment history is temporarily unavailable." zh="银行卡付款记录暂时不可用。" /></p> : <ul>{payments.map(payment => <li key={payment.id}>
      {new Date(payment.created_at).toLocaleDateString(zh ? "zh-CN" : "en-US")} · #{payment.order_id} · {payment.currency === "SGD" ? "S$" : "US$"}{(Number(payment.total_currency_cents ?? payment.total_usd_cents) / 100).toFixed(2)} · {Number(payment.credited_tokens).toLocaleString("en")} {zh ? "积分" : "credits"} · {payment.status === "refunded" ? (zh ? "已退款" : "Refunded") : payment.status === "partial_refund" ? (zh ? "部分退款" : "Partially refunded") : (zh ? "已付款" : "Paid")}{payment.test_mode ? (zh ? " · 测试" : " · Test") : ""}
    </li>)}</ul>}
  </div></article>;
}
