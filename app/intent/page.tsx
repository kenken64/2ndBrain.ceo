import { redirect } from "next/navigation";
import { Atmosphere } from "@/components/atmosphere";
import { BrandHeart } from "@/components/brand-heart";
import { ChatInput } from "@/components/chat-input";
import { LoginDialog } from "@/components/login-dialog";
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
    return (
      <>
        <Atmosphere />
        <main className="auth-page">
          <div className="auth-stack">
            <LoginDialog next={next} supabaseConfigured={hasSupabaseEnv()} />
          </div>
        </main>
      </>
    );
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
          <p className="wizard-kicker">Second Brain intent</p>
          <h1 className="onboarding-title">Describe the Second Brain you want to build</h1>
          <p className="onboarding-copy">
            This prompt seeds the OpenClaw Second Brain project. The generated markdown will appear in the Second Brain dashboard after creation.
          </p>
          <ChatInput
            className="intent-chat"
            defaultPrompt={prompt}
            pendingCopy="Generating the OpenClaw markdown Second Brain, project scaffold, and graph-ready page structure."
            pendingTitle="Generating Second Brain"
            placeholder="Describe the knowledge base, project, or operating system you want the Second Brain to maintain..."
            returnTo="/dashboard/wiki"
          />
        </section>
      </main>
    </>
  );
}
