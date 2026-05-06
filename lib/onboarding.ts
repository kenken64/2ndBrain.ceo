export type OnboardingProfile = {
  avatar_name: string | null;
  telegram_bot_token: string | null;
  onboarding_completed_at: string | null;
};

type ClaimsWithSubject = {
  sub?: unknown;
};

export const onboardingProfileSelect =
  "avatar_name,telegram_bot_token,onboarding_completed_at";

export function getUserIdFromClaims(claims: ClaimsWithSubject | null | undefined) {
  return typeof claims?.sub === "string" ? claims.sub : null;
}

export function isOnboardingComplete(profile: OnboardingProfile | null | undefined) {
  return Boolean(
    profile?.avatar_name?.trim() &&
      profile?.telegram_bot_token?.trim() &&
      profile?.onboarding_completed_at
  );
}

export function onboardingPath(next = "/dashboard") {
  return `/onboarding?next=${encodeURIComponent(next)}`;
}
