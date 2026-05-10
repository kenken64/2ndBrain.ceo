import { redirect } from "next/navigation";
import { Atmosphere } from "@/components/atmosphere";
import { LoginDialog } from "@/components/login-dialog";
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
          <LoginDialog error={params.error} next={next} supabaseConfigured={hasSupabaseEnv()} />
        </div>
      </main>
    </>
  );
}
