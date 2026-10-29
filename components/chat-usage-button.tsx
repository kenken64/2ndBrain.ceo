"use client";

import { Localized, useLanguage, LocalizedMessage } from "@/components/language-provider";

import { useEffect, useRef, useState } from "react";
import { BarChart3, X } from "lucide-react";

type Summary = { request_kind: string; completed_count: number | string; completed_credits: number | string; provider_cost_usd: number | string | null; prompt_tokens: number | string | null; completion_tokens: number | string | null; pending_count: number | string; held_credits: number | string; failed_count: number | string };
type Item = { id: string; created_at: string; model_id: string; request_kind: string; pdf_pages: number | null; prompt_tokens: number | null; completion_tokens: number | null; cost_usd: number | string | null; reserved_credits: number; charged_credits: number | null; quota_exempt: boolean; status: "completed" | "reserved" | "uncertain" | "failed" };
type Usage = { summary: Summary[]; items: Item[]; page: number; hasMore: boolean; availableCredits: number; quotaExempt: boolean };
const labelsZh: Record<string, string> = { chat: "对话", image_ocr: "图片 OCR", pdf_ocr: "PDF OCR", spreadsheet: "电子表格", pdf_generation: "生成 PDF", docx_generation: "生成 DOCX", pptx_generation: "生成 PowerPoint", image_generation: "生成图片", video_generation: "生成视频" };
const labels: Record<string, string> = { chat: "Chat", image_ocr: "Image OCR", pdf_ocr: "PDF OCR", spreadsheet: "Spreadsheet", pdf_generation: "PDF generation", docx_generation: "DOCX generation", pptx_generation: "PowerPoint generation", image_generation: "Image generation", video_generation: "Video generation" };
const number = (value: number | string | null | undefined) => value == null ? "—" : Number(value).toLocaleString("en");
const dollars = (value: number | string | null) => value == null ? "—" : `$${Number(value).toFixed(6)}`;

export function ChatUsageButton() {
  const { language } = useLanguage();
  const zh = language === "zh";
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
    <button className="chat-usage-trigger" type="button" onClick={open}><BarChart3 size={16} aria-hidden="true" /> <Localized en="AI Credits Usage" zh="AI 积分用量" /></button>
    <dialog ref={dialog} className="chat-usage-dialog" aria-labelledby="chat-usage-title" onClose={() => controller.current?.abort()}>
      <div className="chat-usage-header"><div><p className="chat-usage-eyebrow"><Localized en="YOUR ACTIVITY" zh="您的活动" /></p><h2 id="chat-usage-title"><Localized en="AI Credits Usage" zh="AI 积分用量" /></h2><p><Localized en="All your recorded requests in AI Chat, across conversations." zh="所有 AI 对话中记录的请求。" /></p></div><button className="chat-usage-close" type="button" onClick={close} aria-label={zh ? "关闭 AI 积分用量" : "Close AI credits usage"}><X size={20} /></button></div>
      {error ? <div role="alert" className="chat-usage-error"><LocalizedMessage text={error} /> <button type="button" className="text-link" onClick={() => void load(usage?.page ?? 1)}><Localized en="Try again" zh="重试" /></button></div> : null}
      {!usage && loading ? <p role="status"><Localized en="Loading usage…" zh="正在加载用量…" /></p> : null}
      {usage && totals ? <>
        <div className="chat-usage-metrics">
          <div><span><Localized en="Available credits" zh="可用积分" /></span><strong>{usage.quotaExempt ? (zh ? "无限" : "Unlimited") : number(usage.availableCredits)}</strong><small>{usage.quotaExempt ? (zh ? "管理员账户免配额" : "Admin account is exempt") : (zh ? "整个账户" : "Across your account")}</small></div>
          <div><span><Localized en="Chat credits used" zh="对话已用积分" /></span><strong>{number(totals.credits)}</strong><small>{zh ? `${number(totals.requests)} 个已完成请求` : `${number(totals.requests)} completed requests`}</small></div>
          <div><span><Localized en="Provider cost" zh="服务商费用" /></span><strong>{totals.knownCosts ? dollars(totals.cost) : "—"}</strong><small><Localized en="Confirmed chat costs in USD" zh="已确认的对话费用（美元）" /></small></div>
        </div>
        {totals.pending > 0 ? <p className="chat-usage-pending">{zh ? `${number(totals.pending)} 个待处理或未确认请求 · 已预留 ${number(totals.held)} 积分。这些金额尚未最终确定。` : `${number(totals.pending)} pending or unconfirmed request${totals.pending === 1 ? "" : "s"} · ${number(totals.held)} credits held. These amounts are not final.`}</p> : null}
        <div className="chat-usage-section"><div className="chat-usage-section-title"><h3><Localized en="Usage by activity" zh="按活动分类的用量" /></h3><span><Localized en="All time" zh="全部时间" /></span></div>
          {usage.summary.length ? <div className="chat-usage-breakdown">{usage.summary.map(item => <div key={item.request_kind}><div><strong>{(zh ? labelsZh[item.request_kind] : labels[item.request_kind]) ?? item.request_kind}</strong><small>{zh ? `已完成 ${number(item.completed_count)}${Number(item.failed_count) ? ` · 失败 ${number(item.failed_count)}` : ""}` : `${number(item.completed_count)} completed${Number(item.failed_count) ? ` · ${number(item.failed_count)} failed` : ""}`}</small></div><div><strong>{zh ? `${number(item.completed_credits)} 积分` : `${number(item.completed_credits)} credits`}</strong><small>{zh ? `服务商费用 ${dollars(item.provider_cost_usd)}` : `${dollars(item.provider_cost_usd)} provider cost`}</small></div></div>)}</div> : <p><Localized en="No chat usage recorded yet." zh="暂无对话用量记录。" /></p>}
        </div>
        <div className="chat-usage-section"><div className="chat-usage-section-title"><h3><Localized en="Request history" zh="请求记录" /></h3><span><Localized en="Newest first" zh="最新优先" /></span></div>
          {usage.items.length ? <div className="chat-usage-list">{usage.items.map(item => <article key={item.id}><div className="chat-usage-item-main"><strong>{(zh ? labelsZh[item.request_kind] : labels[item.request_kind]) ?? item.request_kind}{item.pdf_pages ? (zh ? ` · ${number(item.pdf_pages)} 页` : ` · ${number(item.pdf_pages)} pages`) : ""}</strong><span>{item.model_id}</span><small>{new Date(item.created_at).toLocaleString(zh ? "zh-CN" : "en")}</small></div><div className="chat-usage-item-cost"><strong>{item.status === "completed" ? (zh ? `${number(item.charged_credits)} 积分` : `${number(item.charged_credits)} credits`) : item.status === "failed" ? (zh ? "不收费" : "No charge") : (zh ? `已预留 ${number(item.charged_credits ?? item.reserved_credits)}` : `${number(item.charged_credits ?? item.reserved_credits)} held`)}</strong><span>{item.status === "completed" ? `${dollars(item.cost_usd)} · ${item.quota_exempt ? (zh ? "免除" : "Exempt") : (zh ? "已完成" : "Completed")}` : item.status === "uncertain" ? (zh ? "未确认" : "Unconfirmed") : item.status === "reserved" ? (zh ? "待处理" : "Pending") : (zh ? "失败" : "Failed")}</span><small>{zh ? `Token 输入 ${number(item.prompt_tokens)} / 输出 ${number(item.completion_tokens)}` : `Tokens ${number(item.prompt_tokens)} in / ${number(item.completion_tokens)} out`}</small></div></article>)}</div> : <p><Localized en="No requests on this page." zh="此页没有请求。" /></p>}
          <div className="chat-usage-pagination"><button type="button" className="btn-ghost" disabled={loading || usage.page <= 1} onClick={() => void load(usage.page - 1)}><Localized en="Previous" zh="上一页" /></button><span>{zh ? `第 ${usage.page} 页` : `Page ${usage.page}`}{loading ? (zh ? " · 加载中…" : " · Loading…") : ""}</span><button type="button" className="btn-ghost" disabled={loading || !usage.hasMore} onClick={() => void load(usage.page + 1)}><Localized en="Next" zh="下一页" /></button></div>
        </div>
        <p className="chat-usage-note"><Localized en="Usage covers AI Chat only. Older records may lack token or cost details. Provider cost is informational; credits shown have already been applied. Other services and marketplace charges are not included." zh="此用量仅涵盖 AI 对话。较早记录可能缺少 Token 或费用详情。服务商费用仅供参考；显示的积分已扣除。不包括其他服务和应用市场费用。" /></p>
        <a className="chat-usage-manage" href="/dashboard/settings?tab=payment"><Localized en="Manage AI credits →" zh="管理 AI 积分 →" /></a>
      </> : null}
    </dialog>
  </>;
}
