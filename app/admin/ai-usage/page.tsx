import { requireAdminPage } from "@/lib/admin";
import { Atmosphere } from "@/components/atmosphere";
import { DashboardSidebar } from "@/components/dashboard-sidebar";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
type Usage = { id: string; user_id: string; created_at: string; model_id: string; request_kind: string; pdf_pages: number | null; prompt_tokens: number | null; completion_tokens: number | null; cost_usd: number | string | null; reserved_credits: number; charged_credits: number | null; quota_exempt: boolean; status: string; provider_request_id: string | null };
export default async function AiUsagePage({ searchParams }: { searchParams: Promise<{ page?: string; user?: string }> }) {
  const params = await searchParams;
  const access = await requireAdminPage({ next: "/admin/ai-usage", requireMfa: true, requireServiceRole: true });
  if (!access.ok || !access.adminSupabase) return <main className="auth-page"><section className="auth-panel"><h1>Admin unavailable</h1><a href="/admin">Return to admin</a></section></main>;
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
    <div className="dashboard-topbar"><div><p className="workspace-status-card__eyebrow">Admin billing</p><h1>Itemized AI usage</h1></div><a className="btn-ghost" href="/admin?tab=billing">Back to billing</a></div>
    <p>Each row is an OpenRouter chat request. Costs are provider costs; credits are already applied to the user’s balance. Reserved or uncertain amounts require reconciliation before invoicing. Older rows may lack item details.</p>
    <form action="/admin/ai-usage" className="ai-usage-filter"><label>User ID <input name="user" defaultValue={user} placeholder="All users" /></label><button className="btn-ghost" type="submit">Filter</button></form>
    {result.error ? <p className="form-error">Usage could not be loaded: {result.error.message}</p> : rows.length === 0 ? <p>No requests found.</p> : <div className="ai-usage-table-wrap"><table className="ai-usage-table"><thead><tr><th>Date (UTC)</th><th>User</th><th>Operation / model</th><th>Tokens in / out</th><th>Provider cost</th><th>Credits</th><th>Status / reference</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{new Date(row.created_at).toISOString().replace("T", " ").slice(0, 19)}</td><td>{emails.get(row.user_id) || "Unknown user"}<br /><small>{row.user_id}</small></td><td>{row.request_kind.replaceAll("_", " ")}{row.pdf_pages ? ` · ${row.pdf_pages} pages` : ""}<br /><small>{row.model_id}</small></td><td>{num(row.prompt_tokens)} / {num(row.completion_tokens)}</td><td>{row.cost_usd == null ? "Unconfirmed" : `$${Number(row.cost_usd).toFixed(6)}`}</td><td>{row.status === "reserved" ? `${num(row.reserved_credits)} reserved` : `${num(row.charged_credits)}${row.quota_exempt ? " (exempt)" : ""}`}</td><td>{row.status}<br /><small>{row.provider_request_id || row.id}</small></td></tr>)}</tbody></table></div>}
    <div className="ai-usage-pagination">{page > 1 ? <a className="btn-ghost" href={pageUrl(page - 1)}>Previous</a> : null}<span>Page {page}</span>{(result.data?.length ?? 0) > PAGE_SIZE ? <a className="btn-ghost" href={pageUrl(page + 1)}>Next</a> : null}</div>
  </section></main></div></>;
}
