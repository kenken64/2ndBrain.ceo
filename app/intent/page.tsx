import { redirect } from "next/navigation";
import { Atmosphere } from "@/components/atmosphere";
import { BrandHeart } from "@/components/brand-heart";
import { ChatInput } from "@/components/chat-input";
import { SetupCallout } from "@/components/setup-callout";
import { hasSupabaseEnv } from "@/lib/env";
import {
  getUserIdFromClaims,
  isOnboardingComplete,
  onboardingPath,
  onboardingProfileSelect,
  type OnboardingProfile
} from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type IntentPageProps = {
  searchParams: Promise<{
    prompt?: string;
  }>;
};

function intentPath(prompt: string) {
  const params = new URLSearchParams();

  if (prompt.trim()) {
    params.set("prompt", prompt.trim());
  }

  const query = params.toString();
  return query ? `/intent?${query}` : "/intent";
}

export default async function IntentPage({ searchParams }: IntentPageProps) {
  const params = await searchParams;
  const prompt = (params.prompt ?? "").trim();
  const next = intentPath(prompt);

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
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(onboardingProfileSelect)
    .eq("id", userId)
    .maybeSingle();

  if (!isOnboardingComplete(profile as OnboardingProfile | null)) {
    redirect(onboardingPath(next));
  }

  return (
    <>
      <Atmosphere />
      <main className="intent-page">
        <section className="intent-panel">
          <BrandHeart size={96} />
          <p className="wizard-kicker">Intent captured</p>
          <h1 className="onboarding-title">Turn this into your first 2ndBrain project</h1>
          <p className="onboarding-copy">
            Review the intent from the homepage and create the project when it is ready.
          </p>
          <ChatInput
            className="intent-chat"
            defaultPrompt={prompt}
            placeholder="Ask 2ndBrain to turn this intent into a dashboard, SOP, or operating system..."
            returnTo="/dashboard"
          />
        </section>
      </main>
    </>
  );
}
