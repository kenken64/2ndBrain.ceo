import { redirect } from "next/navigation";
import { Atmosphere } from "@/components/atmosphere";
import { BrandHeart } from "@/components/brand-heart";
import { SetupCallout } from "@/components/setup-callout";
import { hasSupabaseEnv } from "@/lib/env";
import {
  getUserIdFromClaims,
  isOnboardingComplete,
  onboardingPath,
  onboardingProfileSelect
} from "@/lib/onboarding";
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
      const userId = getUserIdFromClaims(data.claims);

      if (userId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select(onboardingProfileSelect)
          .eq("id", userId)
          .maybeSingle();

        if (!isOnboardingComplete(profile)) {
          redirect(onboardingPath(next));
        }
      }

      redirect(next);
    }
  }

  return (
    <>
      <Atmosphere />
      <main className="auth-page">
        <div className="auth-stack">
          <dialog aria-labelledby="login-title" className="auth-panel login-dialog" open>
            <BrandHeart size={128} />
            <h1 id="login-title">Welcome back</h1>
            <p>Continue with Google to open your 2ndBrain workspace.</p>
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
              New accounts continue into workspace setup.
            </p>
          </dialog>
          {hasSupabaseEnv() ? null : <SetupCallout />}
        </div>
      </main>
    </>
  );
}
