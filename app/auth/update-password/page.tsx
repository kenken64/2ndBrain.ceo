import { LanguageToggle, Localized } from "@/components/language-provider";
import { Atmosphere } from "@/components/atmosphere";
import { BrandLogo } from "@/components/brand-logo";
import { UpdatePasswordForm } from "@/components/update-password-form";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/url";

export const dynamic = "force-dynamic";

export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next ?? null, "/dashboard/chat");
  let authenticated = false;
  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    authenticated = !error && typeof data?.claims?.sub === "string";
  }
  return <><Atmosphere /><main className="auth-page"><div className="auth-stack"><section className="login-dialog" aria-labelledby="update-password-title">
    <LanguageToggle /><div className="login-dialog__brand"><BrandLogo size={82} /></div>
    <div className="login-dialog__copy"><h1 id="update-password-title"><Localized en="Set a new password" zh="设置新密码" /></h1><p><Localized en="Choose a new password for your account." zh="为您的账户选择新密码。" /></p></div>
    {authenticated ? <UpdatePasswordForm next={next} /> : <p className="login-dialog__message" role="alert"><Localized en={<>Your recovery session is unavailable or expired. <a href={`/login?next=${encodeURIComponent(next)}`}>Return to sign in</a> and request a new reset link.</>} zh={<>恢复会话不可用或已过期。请<a href={`/login?next=${encodeURIComponent(next)}`}>返回登录</a>并请求新的重置链接。</>} /></p>}
  </section></div></main></>;
}
