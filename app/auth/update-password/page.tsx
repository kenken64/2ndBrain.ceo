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
    <div className="login-dialog__brand"><BrandLogo size={82} /></div>
    <div className="login-dialog__copy"><h1 id="update-password-title">Set a new password</h1><p>Choose a new password for your account.</p></div>
    {authenticated ? <UpdatePasswordForm next={next} /> : <p className="login-dialog__message" role="alert">Your recovery session is unavailable or expired. <a href={`/login?next=${encodeURIComponent(next)}`}>Return to sign in</a> and request a new reset link.</p>}
  </section></div></main></>;
}
