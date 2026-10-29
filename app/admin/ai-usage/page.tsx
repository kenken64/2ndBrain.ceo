import { Localized, LocalizedInput, LocalizedMessage } from "@/components/language-provider";
import { requireAdminPage } from "@/lib/admin";
import { Atmosphere } from "@/components/atmosphere";
import { DashboardSidebar } from "@/components/dashboard-sidebar";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
type Usage = { id: string; user_id: string; created_at: string; model_id: string; request_kind: string; pdf_pages: number | null; prompt_tokens: number | null; completion_tokens: number | null; cost_usd: number | string | null; reserved_credits: number; charged_credits: number | null; quota_exempt: boolean; status: string; provider_request_id: string | null };
export default async function AiUsagePage({ searchParams }: { searchParams: Promise<{ page?: string; user?: string }> }) {
  const params = await searchParams;
  const access = await requireAdminPage({ next: "/admin/ai-usage", requireMfa: true, requireServiceRole: true });
  if (!access.ok || !access.adminSupabase) return <main className="auth-page"><section className="auth-panel"><h1><Localized en={"Admin unavailable"} zh={"管理功能不可用"} /></h1><a href="/admin"><Localized en={"Return to admin"} zh={"返回管理页面"} /></a></section></main>;
  const page = Math.min(10000, Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1));
  const user = (params.user ?? "").trim();
  const validUser = !user || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user);
  let query = access.adminSupabase.from("chat_credit_requests").select("id,user_id,created_at,model_id,request_kind,pdf_pages,prompt_tokens,completion_tokens,cost_usd,reserved_credits,charged_credits,quota_exempt,status,provider_request_id").order("created_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  if (user && validUser) query = query.eq("user_id", user);
  const result = validUser ? await query : { data: null, error: { message: "Enter a valid user ID." } };
  const rows = ((result.data ?? []) as Usage[]).slice(0, PAGE_SIZE);
  const ids = Array.from(new Set(rows.map(row => row.user_id)));
  const profiles = ids.length ? await access.adminSupabase.from("profiles").select("id,email").in("id", ids) : { data: [] };
  const emails = new Map((profiles.data ?? []).map((profile: { id: string; email: string | null }) => [profile.id, profile.email]));
  const pageUrl = (number: number) => `/admin/ai-usage?${new URLSearchParams({ page: String(number), ...(user ? { user } : {}) })}`;
  const num = (value: number | null) => value == null ? "—" : Number(value).toLocaleString("en");
  return <><Atmosphere /><div className="dashboard-layout"><DashboardSidebar activeItem="admin" email={access.email} ownerName="Admin" /><main className="dashboard-main"><section className="dashboard-workbench">
    <div className="dashboard-topbar"><div><p className="workspace-status-card__eyebrow"><Localized en={"Admin billing"} zh={"管理账单"} /></p><h1><Localized en={"Itemized AI usage"} zh={"AI 用量明细"} /></h1></div><a className="btn-ghost" href="/admin?tab=billing"><Localized en={"Back to billing"} zh={"返回账单"} /></a></div>
    <p><Localized en={"Each row is an OpenRouter chat request. Costs are provider costs; credits are already applied to the user’s balance. Reserved or uncertain amounts require reconciliation before invoicing. Older rows may lack item details."} zh={"每行代表一次 OpenRouter 对话请求。费用为服务商费用；积分已计入用户余额。预留或未确认的金额在开票前需要核对。较早的记录可能缺少明细。"} /></p>
    <form action="/admin/ai-usage" className="ai-usage-filter"><label><Localized en={"User ID"} zh={"用户 ID"} /><LocalizedInput name="user" defaultValue={user} placeholderEn="All users" placeholderZh="所有用户" /></label><button className="btn-ghost" type="submit"><Localized en={"Filter"} zh={"筛选"} /></button></form>
    {result.error ? <p className="form-error"><Localized en={`Usage could not be loaded: ${result.error.message}`} zh={`无法加载用量：${result.error.message}`} /></p> : rows.length === 0 ? <p><Localized en={"No requests found."} zh={"未找到请求。"} /></p> : <div className="ai-usage-table-wrap"><table className="ai-usage-table"><thead><tr><th><Localized en={"Date (UTC)"} zh={"日期（UTC）"} /></th><th><Localized en={"User"} zh={"用户"} /></th><th><Localized en={"Operation / model"} zh={"操作 / 模型"} /></th><th><Localized en={"Tokens in / out"} zh={"输入 / 输出 Token"} /></th><th><Localized en={"Provider cost"} zh={"服务商费用"} /></th><th><Localized en={"Credits"} zh={"积分"} /></th><th><Localized en={"Status / reference"} zh={"状态 / 参考编号"} /></th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{new Date(row.created_at).toISOString().replace("T", " ").slice(0, 19)}</td><td>{emails.get(row.user_id) || <Localized en="Unknown user" zh="未知用户" />}<br /><small>{row.user_id}</small></td><td><LocalizedMessage text={row.request_kind.replaceAll("_", " ")} />{row.pdf_pages ? <Localized en={` · ${row.pdf_pages} pages`} zh={` · ${row.pdf_pages} 页`} /> : ""}<br /><small>{row.model_id}</small></td><td>{num(row.prompt_tokens)} / {num(row.completion_tokens)}</td><td>{row.cost_usd == null ? <Localized en={"Unconfirmed"} zh={"未确认"} /> : `$${Number(row.cost_usd).toFixed(6)}`}</td><td>{row.status === "reserved" ? <Localized en={`${num(row.reserved_credits)} reserved`} zh={`已预留 ${num(row.reserved_credits)}`} /> : <Localized en={`${num(row.charged_credits)}${row.quota_exempt ? " (exempt)" : ""}`} zh={`${num(row.charged_credits)}${row.quota_exempt ? "（免除）" : ""}`} />}</td><td><LocalizedMessage text={row.status} /><br /><small>{row.provider_request_id || row.id}</small></td></tr>)}</tbody></table></div>}
    <div className="ai-usage-pagination">{page > 1 ? <a className="btn-ghost" href={pageUrl(page - 1)}><Localized en={"Previous"} zh={"上一页"} /></a> : null}<span><Localized en={`Page ${page}`} zh={`第 ${page} 页`} /></span>{(result.data?.length ?? 0) > PAGE_SIZE ? <a className="btn-ghost" href={pageUrl(page + 1)}><Localized en={"Next"} zh={"下一页"} /></a> : null}</div>
  </section></main></div></>;
}
