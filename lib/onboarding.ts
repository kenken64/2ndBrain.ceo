export type OnboardingProfile = {
  avatar_name: string | null;
  telegram_bot_token: string | null;
  avaturn_avatar_url: string | null;
  avatar_glb_path: string | null;
  onboarding_completed_at: string | null;
};

type ClaimsWithSubject = {
  sub?: unknown;
};

export const onboardingSteps = ["profile", "telegram", "avatar"] as const;
export type OnboardingStep = (typeof onboardingSteps)[number];

export const onboardingProfileSelect =
  "avatar_name,telegram_bot_token,avaturn_avatar_url,avatar_glb_path,onboarding_completed_at";

export function getUserIdFromClaims(claims: ClaimsWithSubject | null | undefined) {
  return typeof claims?.sub === "string" ? claims.sub : null;
}

export function isOnboardingComplete(profile: OnboardingProfile | null | undefined) {
  return Boolean(
    profile?.avatar_name?.trim() &&
      profile?.telegram_bot_token?.trim() &&
      profile?.avaturn_avatar_url?.trim() &&
      profile?.avatar_glb_path?.trim() &&
      profile?.onboarding_completed_at
  );
}

export function getRequiredOnboardingStep(
  profile: OnboardingProfile | null | undefined
): OnboardingStep | null {
  if (!profile?.avatar_name?.trim()) {
    return "profile";
  }

  if (!profile.telegram_bot_token?.trim()) {
    return "telegram";
  }

  if (
    !profile.avaturn_avatar_url?.trim() ||
    !profile.avatar_glb_path?.trim() ||
    !profile.onboarding_completed_at
  ) {
    return "avatar";
  }

  return null;
}

export function parseOnboardingStep(value: string | null | undefined): OnboardingStep | null {
  return onboardingSteps.find((step) => step === value) ?? null;
}

export function onboardingPath(next = "/dashboard", step?: OnboardingStep) {
  const params = new URLSearchParams({ next });

  if (step) {
    params.set("step", step);
  }

  return `/onboarding?${params.toString()}`;
}
