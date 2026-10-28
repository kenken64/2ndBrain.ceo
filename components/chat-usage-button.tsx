"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, X } from "lucide-react";

type Summary = { request_kind: string; completed_count: number | string; completed_credits: number | string; provider_cost_usd: number | string | null; prompt_tokens: number | string | null; completion_tokens: number | string | null; pending_count: number | string; held_credits: number | string; failed_count: number | string };
type Item = { id: string; created_at: string; model_id: string; request_kind: string; pdf_pages: number | null; prompt_tokens: number | null; completion_tokens: number | null; cost_usd: number | string | null; reserved_credits: number; charged_credits: number | null; quota_exempt: boolean; status: "completed" | "reserved" | "uncertain" | "failed" };
type Usage = { summary: Summary[]; items: Item[]; page: number; hasMore: boolean; availableCredits: number; quotaExempt: boolean };
const labels: Record<string, string> = { chat: "Chat", image_ocr: "Image OCR", pdf_ocr: "PDF OCR", spreadsheet: "Spreadsheet" };
const number = (value: number | string | null | undefined) => value == null ? "—" : Number(value).toLocaleString("en");
const dollars = (value: number | string | null) => value == null ? "—" : `$${Number(value).toFixed(6)}`;

export function ChatUsageButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function load(page: number) {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/chat/usage?page=${page}`, { cache: "no-store", signal: current.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Could not load usage.");
      setUsage(body as Usage);
    } catch (reason) {
      if (!current.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load usage.");
    } finally { if (!current.signal.aborted) setLoading(false); }
  }
  function open() { dialog.current?.showModal(); setUsage(null); void load(1); }
  function close() { controller.current?.abort(); dialog.current?.close(); }
  const totals = usage?.summary.reduce((acc, item) => ({
    credits: acc.credits + Number(item.completed_credits), pending: acc.pending + Number(item.pending_count), held: acc.held + Number(item.held_credits),
    requests: acc.requests + Number(item.completed_count), cost: acc.cost + Number(item.provider_cost_usd ?? 0), knownCosts: acc.knownCosts + (item.provider_cost_usd == null ? 0 : 1)
  }), { credits: 0, pending: 0, held: 0, requests: 0, cost: 0, knownCosts: 0 });

  return <>
    <button className="chat-usage-trigger" type="button" onClick={open}><BarChart3 size={16} aria-hidden="true" /> AI Credits Usage</button>
    <dialog ref={dialog} className="chat-usage-dialog" aria-labelledby="chat-usage-title" onClose={() => controller.current?.abort()}>
      <div className="chat-usage-header"><div><p className="chat-usage-eyebrow">YOUR ACTIVITY</p><h2 id="chat-usage-title">AI Credits Usage</h2><p>All your recorded requests in AI Chat, across conversations.</p></div><button className="chat-usage-close" type="button" onClick={close} aria-label="Close AI credits usage"><X size={20} /></button></div>
      {error ? <div role="alert" className="chat-usage-error">{error} <button type="button" className="text-link" onClick={() => void load(usage?.page ?? 1)}>Try again</button></div> : null}
      {!usage && loading ? <p role="status">Loading usage…</p> : null}
      {usage && totals ? <>
        <div className="chat-usage-metrics">
          <div><span>Available credits</span><strong>{usage.quotaExempt ? "Unlimited" : number(usage.availableCredits)}</strong><small>{usage.quotaExempt ? "Admin account is exempt" : "Across your account"}</small></div>
          <div><span>Chat credits used</span><strong>{number(totals.credits)}</strong><small>{number(totals.requests)} completed requests</small></div>
          <div><span>Provider cost</span><strong>{totals.knownCosts ? dollars(totals.cost) : "—"}</strong><small>Confirmed chat costs in USD</small></div>
        </div>
        {totals.pending > 0 ? <p className="chat-usage-pending">{number(totals.pending)} pending or unconfirmed request{totals.pending === 1 ? "" : "s"} · {number(totals.held)} credits held. These amounts are not final.</p> : null}
        <div className="chat-usage-section"><div className="chat-usage-section-title"><h3>Usage by activity</h3><span>All time</span></div>
          {usage.summary.length ? <div className="chat-usage-breakdown">{usage.summary.map(item => <div key={item.request_kind}><div><strong>{labels[item.request_kind] ?? item.request_kind}</strong><small>{number(item.completed_count)} completed{Number(item.failed_count) ? ` · ${number(item.failed_count)} failed` : ""}</small></div><div><strong>{number(item.completed_credits)} credits</strong><small>{dollars(item.provider_cost_usd)} provider cost</small></div></div>)}</div> : <p>No chat usage recorded yet.</p>}
        </div>
        <div className="chat-usage-section"><div className="chat-usage-section-title"><h3>Request history</h3><span>Newest first</span></div>
          {usage.items.length ? <div className="chat-usage-list">{usage.items.map(item => <article key={item.id}><div className="chat-usage-item-main"><strong>{labels[item.request_kind] ?? item.request_kind}{item.pdf_pages ? ` · ${number(item.pdf_pages)} pages` : ""}</strong><span>{item.model_id}</span><small>{new Date(item.created_at).toLocaleString()}</small></div><div className="chat-usage-item-cost"><strong>{item.status === "completed" ? `${number(item.charged_credits)} credits` : item.status === "failed" ? "No charge" : `${number(item.charged_credits ?? item.reserved_credits)} held`}</strong><span>{item.status === "completed" ? `${dollars(item.cost_usd)} · ${item.quota_exempt ? "Exempt" : "Completed"}` : item.status === "uncertain" ? "Unconfirmed" : item.status === "reserved" ? "Pending" : "Failed"}</span><small>Tokens {number(item.prompt_tokens)} in / {number(item.completion_tokens)} out</small></div></article>)}</div> : <p>No requests on this page.</p>}
          <div className="chat-usage-pagination"><button type="button" className="btn-ghost" disabled={loading || usage.page <= 1} onClick={() => void load(usage.page - 1)}>Previous</button><span>Page {usage.page}{loading ? " · Loading…" : ""}</span><button type="button" className="btn-ghost" disabled={loading || !usage.hasMore} onClick={() => void load(usage.page + 1)}>Next</button></div>
        </div>
        <p className="chat-usage-note">Usage covers AI Chat only. Older records may lack token or cost details. Provider cost is informational; credits shown have already been applied. Other services and marketplace charges are not included.</p>
        <a className="chat-usage-manage" href="/dashboard/settings?tab=payment">Manage AI credits →</a>
      </> : null}
    </dialog>
  </>;
}
