import { redirect } from "next/navigation";
import { Bot, Sparkles } from "lucide-react";
import { Atmosphere } from "@/components/atmosphere";
import { BrandHeart } from "@/components/brand-heart";
import { SetupCallout } from "@/components/setup-callout";
import { hasSupabaseEnv } from "@/lib/env";
import {
  getUserIdFromClaims,
  isOnboardingComplete,
  onboardingProfileSelect,
  type OnboardingProfile
} from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/url";

export const dynamic = "force-dynamic";

type OnboardingPageProps = {
  searchParams: Promise<{
    next?: string;
    error?: string;
  }>;
};

const errors: Record<string, string> = {
  missing_fields: "Add an avatar name and Telegram bot token to continue.",
  save_failed: "Profile setup could not be saved. Check that the onboarding migration has run."
};

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const params = await searchParams;
  const next = safeNextPath(params.next ?? "/dashboard");

  if (!hasSupabaseEnv()) {
    return (
      <>
        <Atmosphere />
        <main className="auth-page">
          <SetupCallout />
        </main>
      </>
    );
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(claimsData?.claims);

  if (claimsError || !userId) {
    redirect(`/login?next=${encodeURIComponent("/onboarding")}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(onboardingProfileSelect)
    .eq("id", userId)
    .maybeSingle();

  if (isOnboardingComplete(profile as OnboardingProfile | null)) {
    redirect(next);
  }

  const avatarName = (profile as OnboardingProfile | null)?.avatar_name ?? "";
  const errorMessage = params.error ? errors[params.error] ?? "Profile setup needs another try." : null;

  return (
    <>
      <Atmosphere />
      <main className="onboarding-page">
        <section className="onboarding-card">
          <BrandHeart size={120} />
          <p className="wizard-kicker">Workspace setup</p>
          <h1 className="onboarding-title">Name your avatar and connect Telegram</h1>
          <form action="/api/onboarding" className="onboarding-form" method="post">
            <input name="next" type="hidden" value={next} />
            <label className="field-stack">
              <span>
                <Sparkles size={18} strokeWidth={1.8} />
                Avatar name
              </span>
              <input
                autoComplete="off"
                defaultValue={avatarName}
                maxLength={80}
                name="avatarName"
                placeholder="Ari"
                required
                type="text"
              />
            </label>
            <label className="field-stack">
              <span>
                <Bot size={18} strokeWidth={1.8} />
                Telegram bot token
              </span>
              <input
                autoComplete="off"
                name="telegramBotToken"
                placeholder="123456789:AA..."
                required
                type="password"
              />
            </label>
            {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
            <button className="btn-primary onboarding-submit" type="submit">
              Finish setup <span className="arrow">-&gt;</span>
            </button>
          </form>
          <div aria-hidden="true" className="pagination">
            <span className="pagination-dot" />
            <span className="pagination-dot" />
            <span className="pagination-dot current" />
          </div>
        </section>
      </main>
    </>
  );
}
