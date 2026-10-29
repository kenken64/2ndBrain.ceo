import { Localized } from "@/components/language-provider";

export function SetupCallout() {
  return (
    <section className="setup-callout">
      <h2><Localized en="Supabase is not configured yet" zh="尚未配置 Supabase" /></h2>
      <p><Localized en={<>Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> to <code>.env.local</code>. If Supabase only shows a legacy anon key, use <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> instead. On Railway, either add the same variables to the service Variables tab or use <code>SUPABASE_URL</code> plus <code>SUPABASE_ANON_KEY</code>, then set <code>NEXT_PUBLIC_SITE_URL</code> to the generated public URL.</>} zh={<>请将 <code>NEXT_PUBLIC_SUPABASE_URL</code> 和 <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> 添加到 <code>.env.local</code>。如果 Supabase 只显示旧版 anon 密钥，请改用 <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>。在 Railway 上，可将相同变量添加到服务的 Variables 标签页，或使用 <code>SUPABASE_URL</code> 和 <code>SUPABASE_ANON_KEY</code>，然后将 <code>NEXT_PUBLIC_SITE_URL</code> 设置为生成的公共地址。</>} /></p>
    </section>
  );
}
