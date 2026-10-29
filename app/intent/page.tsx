import { LanguageToggle, Localized } from "@/components/language-provider";
import { redirect } from "next/navigation";
import { Atmosphere } from "@/components/atmosphere";
import { BrandLogo } from "@/components/brand-logo";
import { ChatInput } from "@/components/chat-input";
import { LoginDialog } from "@/components/login-dialog";
import { SetupCallout } from "@/components/setup-callout";
import { hasSupabaseEnv, isWechatLoginEnabled } from "@/lib/env";
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
            <LoginDialog next={next} supabaseConfigured={hasSupabaseEnv()} wechatEnabled={isWechatLoginEnabled()} />
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
          <LanguageToggle />
          <BrandLogo size={96} />
          <p className="wizard-kicker"><Localized en="Nth Brain intent" zh="Nth Brain 需求" /></p>
          <h1 className="onboarding-title"><Localized en="Describe the Nth Brain you want to build" zh="描述您想创建的 Nth Brain" /></h1>
          <p className="onboarding-copy">
            <Localized en="This prompt seeds the AI Agent Nth Brain project. The generated markdown will appear in the Nth Brain dashboard after creation." zh="此需求将用于创建 AI Agent Nth Brain 项目。创建完成后，生成的 Markdown 将显示在 Nth Brain 工作台中。" />
          </p>
          <ChatInput
            className="intent-chat"
            defaultPrompt={prompt}
            pendingCopy="Generating the AI Agent markdown Nth Brain, project scaffold, and graph-ready page structure."
            pendingTitle="Generating Nth Brain"
            placeholder="Describe the knowledge base, project, or operating system you want the Nth Brain to maintain..."
            returnTo="/dashboard/wiki"
          />
        </section>
      </main>
    </>
  );
}
