import { redirect } from "next/navigation";
import { Bot, Sparkles } from "lucide-react";
import { Atmosphere } from "@/components/atmosphere";
import { AvaturnStep } from "@/components/avaturn-step";
import { BrandHeart } from "@/components/brand-heart";
import { SetupCallout } from "@/components/setup-callout";
import { hasSupabaseEnv } from "@/lib/env";
import {
  getRequiredOnboardingStep,
  getUserIdFromClaims,
  isOnboardingComplete,
  onboardingPath,
  onboardingProfileSelect,
  onboardingSteps,
  parseOnboardingStep,
  type OnboardingProfile,
  type OnboardingStep
} from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/url";

export const dynamic = "force-dynamic";

type OnboardingPageProps = {
  searchParams: Promise<{
    next?: string;
    error?: string;
    step?: string;
  }>;
};

const errors: Record<string, string> = {
  avatar_download_failed: "Avatar export could not be downloaded. Export it again and retry.",
  avatar_download_not_glb: "The exported avatar did not look like a GLB file. Export a GLB from Avaturn.",
  avatar_download_too_large: "The exported avatar is too large to store locally.",
  invalid_avatar_url: "Avaturn did not return a valid secure GLB URL yet.",
  missing_avatar: "Create and export your Avaturn avatar to continue.",
  missing_fields: "Add the required field to continue.",
  save_failed: "Profile setup could not be saved. Check that the onboarding migrations have run."
};

const stepMeta: Record<OnboardingStep, { index: number; kicker: string; title: string; copy: string }> = {
  profile: {
    index: 0,
    kicker: "Step 1 of 3",
    title: "Name your 2ndBrain",
    copy: "This is the name your workspace and assistant will use across the product."
  },
  telegram: {
    index: 1,
    kicker: "Step 2 of 3",
    title: "Connect your Telegram bot",
    copy: "Add the bot token so 2ndBrain can receive and route Telegram context later."
  },
  avatar: {
    index: 2,
    kicker: "Step 3 of 3",
    title: "Create your Avaturn avatar",
    copy: "Build your avatar, export the GLB, and we will save it locally for the OpenClaw upload."
  }
};

function Stepper({ current }: { current: OnboardingStep }) {
  const currentIndex = stepMeta[current].index;

  return (
    <ol aria-label="Setup progress" className="wizard-stepper">
      {onboardingSteps.map((step) => (
        <li className={stepMeta[step].index <= currentIndex ? "is-active" : ""} key={step}>
          <span>{stepMeta[step].index + 1}</span>
          {step}
        </li>
      ))}
    </ol>
  );
}

function ProfileStep({
  avatarName,
  errorMessage,
  next
}: {
  avatarName: string;
  errorMessage: string | null;
  next: string;
}) {
  return (
    <form action="/api/onboarding" className="onboarding-form" method="post">
      <input name="step" type="hidden" value="profile" />
      <input name="next" type="hidden" value={next} />
      <label className="field-stack">
        <span>
          <Sparkles size={18} strokeWidth={1.8} />
          Your 2ndBrain name
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
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
      <button className="btn-primary onboarding-submit" type="submit">
        Continue <span className="arrow">-&gt;</span>
      </button>
    </form>
  );
}

function TelegramStep({
  errorMessage,
  next
}: {
  errorMessage: string | null;
  next: string;
}) {
  return (
    <form action="/api/onboarding" className="onboarding-form" method="post">
      <input name="step" type="hidden" value="telegram" />
      <input name="next" type="hidden" value={next} />
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
        Continue <span className="arrow">-&gt;</span>
      </button>
    </form>
  );
}

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
    redirect(`/login?next=${encodeURIComponent(onboardingPath(next))}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(onboardingProfileSelect)
    .eq("id", userId)
    .maybeSingle();

  const onboardingProfile = profile as OnboardingProfile | null;

  if (isOnboardingComplete(onboardingProfile)) {
    redirect(next);
  }

  const requiredStep = getRequiredOnboardingStep(onboardingProfile) ?? "profile";
  const requestedStep = parseOnboardingStep(params.step);
  const currentStep = requestedStep ?? requiredStep;

  if (stepMeta[currentStep].index > stepMeta[requiredStep].index) {
    redirect(onboardingPath(next, requiredStep));
  }

  const meta = stepMeta[currentStep];
  const errorMessage = params.error ? errors[params.error] ?? "Setup needs another try." : null;

  return (
    <>
      <Atmosphere />
      <main className="onboarding-page">
        <section className={`onboarding-card onboarding-card--${currentStep}`}>
          <BrandHeart size={currentStep === "avatar" ? 88 : 120} />
          <Stepper current={currentStep} />
          <p className="wizard-kicker">{meta.kicker}</p>
          <h1 className="onboarding-title">{meta.title}</h1>
          <p className="onboarding-copy">{meta.copy}</p>

          {currentStep === "profile" ? (
            <ProfileStep
              avatarName={onboardingProfile?.avatar_name ?? ""}
              errorMessage={errorMessage}
              next={next}
            />
          ) : null}

          {currentStep === "telegram" ? (
            <TelegramStep errorMessage={errorMessage} next={next} />
          ) : null}

          {currentStep === "avatar" ? (
            <AvaturnStep errorMessage={errorMessage} next={next} />
          ) : null}
        </section>
      </main>
    </>
  );
}
