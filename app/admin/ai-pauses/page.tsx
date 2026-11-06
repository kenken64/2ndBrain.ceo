import { LanguageToggle, Localized, LocalizedInput } from "@/components/language-provider";
import { requireAdminPage } from "@/lib/admin";
import { Atmosphere } from "@/components/atmosphere";
import { DashboardSidebar } from "@/components/dashboard-sidebar";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
type PauseEvent = {
  id: string;
  target_user_id: string | null;
  target_email: string | null;
  admin_email: string | null;
  action: "ai_usage_paused" | "ai_usage_resumed";
  created_at: string;
  details: { user_name?: string | null; source?: string } | null;
};

export default async function AiPausesPage({ searchParams }: { searchParams: Promise<{ page?: string; user?: string; event?: string }> }) {
  const params = await searchParams;
  const access = await requireAdminPage({ next: "/admin/ai-pauses", requireMfa: true, requireServiceRole: true });
  if (!access.ok || !access.adminSupabase) {
    return <main className="auth-page"><section className="auth-panel"><h1><Localized en="Admin unavailable" zh="管理功能不可用" /></h1><a href="/admin"><Localized en="Return to admin" zh="返回管理页面" /></a></section></main>;
  }

  const page = Math.min(10000, Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1));
  const user = (params.user ?? "").trim();
  const isUserId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user);
  const validUser = !user || isUserId || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user);
  const event = params.event === "all" || params.event === "resumed" ? params.event : "paused";
  let query = access.adminSupabase.from("admin_audit_events")
    .select("id,target_user_id,target_email,admin_email,action,created_at,details")
    .in("action", event === "all" ? ["ai_usage_paused", "ai_usage_resumed"] : [event === "paused" ? "ai_usage_paused" : "ai_usage_resumed"])
    .eq("status", "success")
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  if (user && validUser) query = query.eq(isUserId ? "target_user_id" : "target_email", isUserId ? user : user.toLowerCase());
  const result = validUser ? await query : { data: null, error: { message: "Enter a valid user email or ID." } };
  const rows = ((result.data ?? []) as PauseEvent[]).slice(0, PAGE_SIZE);
  const pageUrl = (number: number) => `/admin/ai-pauses?${new URLSearchParams({ page: String(number), event, ...(user ? { user } : {}) })}`;
  const dateTime = (value: string) => new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Singapore", hour12: false
  }).format(new Date(value));

  return <><Atmosphere /><div className="dashboard-layout">
    <DashboardSidebar activeItem="admin" email={access.email} ownerName="Admin" />
    <main className="dashboard-main"><section className="dashboard-workbench">
      <div className="dashboard-topbar">
        <div><p className="workspace-status-card__eyebrow"><Localized en="User activity" zh="用户活动" /></p><h1><Localized en="AI pause history" zh="AI 暂停历史" /></h1></div>
        <div className="dashboard-topbar__actions"><LanguageToggle /><a className="btn-ghost" href="/admin?tab=users"><Localized en="Back to users" zh="返回用户列表" /></a></div>
      </div>
      <p><Localized en="Review who paused or resumed AI usage and when. Times are shown in Singapore time (SGT, UTC+8). History remains after users resume. Earlier records include only the latest timestamps previously saved for each user." zh="查看谁在何时暂停或恢复了 AI 用量。时间以新加坡时间（SGT，UTC+8）显示，用户恢复后历史记录仍会保留。较早的记录仅包括此前为每位用户保存的最近时间。" /></p>
      <form action="/admin/ai-pauses" className="ai-usage-filter">
        <label><Localized en="User email or ID" zh="用户邮箱或 ID" /><LocalizedInput name="user" defaultValue={user} placeholderEn="All users" placeholderZh="所有用户" /></label>
        <label><Localized en="Event" zh="事件" /><select name="event" defaultValue={event}>
          <option value="paused"><Localized en="Pauses" zh="暂停" /></option>
          <option value="resumed"><Localized en="Resumes" zh="恢复" /></option>
          <option value="all"><Localized en="All events" zh="所有事件" /></option>
        </select></label>
        <button className="btn-ghost" type="submit"><Localized en="Filter" zh="筛选" /></button>
      </form>
      {result.error ? <p className="form-error" role="alert"><Localized en="Pause history could not be loaded." zh="无法加载暂停历史。" /></p> : rows.length === 0 ? <p><Localized en="No matching pause events." zh="没有匹配的暂停事件。" /></p> : <div className="ai-usage-table-wrap"><table className="ai-usage-table">
        <thead><tr><th><Localized en="Date and time (SGT)" zh="日期和时间（SGT）" /></th><th><Localized en="User" zh="用户" /></th><th><Localized en="Event" zh="事件" /></th><th><Localized en="Changed by" zh="操作人" /></th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <td><time dateTime={row.created_at}><Localized en={`${dateTime(row.created_at)} SGT`} zh={`${dateTime(row.created_at)} 新加坡时间`} /></time></td>
          <td>{row.details?.user_name || row.target_email || <Localized en="Deleted user" zh="已删除的用户" />}<br /><small>{row.details?.user_name ? row.target_email : null}</small><br /><small>{row.target_user_id}</small></td>
          <td><Localized en={row.action === "ai_usage_paused" ? "Paused AI usage" : "Resumed AI usage"} zh={row.action === "ai_usage_paused" ? "已暂停 AI 用量" : "已恢复 AI 用量"} />{row.details?.source === "existing_timestamp" ? <><br /><small><Localized en="Previous recorded timestamp" zh="此前记录的时间" /></small></> : null}</td>
          <td>{row.admin_email || <Localized en="Not recorded" zh="未记录" />}</td>
        </tr>)}</tbody>
      </table></div>}
      <div className="ai-usage-pagination">
        {page > 1 ? <a className="btn-ghost" href={pageUrl(page - 1)}><Localized en="Previous" zh="上一页" /></a> : null}
        <span><Localized en={`Page ${page}`} zh={`第 ${page} 页`} /></span>
        {(result.data?.length ?? 0) > PAGE_SIZE ? <a className="btn-ghost" href={pageUrl(page + 1)}><Localized en="Next" zh="下一页" /></a> : null}
      </div>
    </section></main>
  </div></>;
}
