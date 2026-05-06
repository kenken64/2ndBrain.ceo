import { redirect } from "next/navigation";
import { Atmosphere } from "@/components/atmosphere";
import { BrandHeart } from "@/components/brand-heart";
import { SetupCallout } from "@/components/setup-callout";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/url";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{
    next?: string;
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = safeNextPath(params.next ?? "/dashboard");

  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();

    if (data?.claims) {
      redirect(next);
    }
  }

  return (
    <>
      <Atmosphere />
      <main className="auth-page">
        <div className="auth-stack">
          <section className="auth-panel">
            <BrandHeart size={128} />
            <h1>Log in to 2ndBrain</h1>
            <p>Use Google OAuth through Supabase to access your workspace.</p>
            {params.error ? (
              <p className="auth-panel__footnote">
                Authentication could not complete: {params.error}
              </p>
            ) : null}
            {hasSupabaseEnv() ? (
              <a className="google-button" href={`/auth/login?next=${encodeURIComponent(next)}`}>
                <span aria-hidden="true" className="google-g">
                  G
                </span>
                Continue with Google
              </a>
            ) : null}
            <p className="auth-panel__footnote">
              New accounts are created by Supabase Auth after Google consent.
            </p>
          </section>
          {hasSupabaseEnv() ? null : <SetupCallout />}
        </div>
      </main>
    </>
  );
}
