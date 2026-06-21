export type OnboardingProfile = {
  owner_name: string | null;
  avatar_name: string | null;
  avatar_gender: string | null;
  telegram_bot_token: string | null;
  enrolment_completed_at: string | null;
  avaturn_avatar_url: string | null;
  avatar_glb_path: string | null;
  avatar_completed_at: string | null;
  openclaw_instance: string | null;
  openclaw_gateway_url: string | null;
  openclaw_gateway_completed_at: string | null;
  openclaw_tokens_pause_reason: string | null;
  openclaw_tokens_paused: boolean | null;
  openclaw_tokens_paused_at: string | null;
  openclaw_tokens_resumed_at: string | null;
  openclaw_provision_started_at: string | null;
  openclaw_provision_status: string | null;
  openclaw_provision_completed_at: string | null;
  openclaw_identity_completed_at: string | null;
  openclaw_remotion_url: string | null;
  openclaw_remotion_completed_at: string | null;
  openclaw_hooks_completed_at: string | null;
  openclaw_telegram_pair_completed_at: string | null;
  openclaw_telegram_pair_status: string | null;
  onboarding_completed_at: string | null;
  provision_target: string | null;
};

type ClaimsWithSubject = {
  sub?: unknown;
};

export const onboardingSteps = ["enrolment", "avatar", "agent", "provision", "approval"] as const;
export type OnboardingStep = (typeof onboardingSteps)[number];

export const onboardingProfileSelect =
  "owner_name,avatar_name,avatar_gender,telegram_bot_token,enrolment_completed_at,avaturn_avatar_url,avatar_glb_path,avatar_completed_at,provision_target,openclaw_instance,openclaw_gateway_url,openclaw_gateway_completed_at,openclaw_tokens_paused,openclaw_tokens_paused_at,openclaw_tokens_resumed_at,openclaw_tokens_pause_reason,openclaw_provision_started_at,openclaw_provision_status,openclaw_provision_completed_at,openclaw_identity_completed_at,openclaw_remotion_url,openclaw_remotion_completed_at,openclaw_hooks_completed_at,openclaw_telegram_pair_status,openclaw_telegram_pair_completed_at,onboarding_completed_at";

export function getUserIdFromClaims(claims: ClaimsWithSubject | null | undefined) {
  return typeof claims?.sub === "string" ? claims.sub : null;
}

export function isOnboardingComplete(profile: OnboardingProfile | null | undefined) {
  return Boolean(
    profile?.owner_name?.trim() &&
      profile?.avatar_name?.trim() &&
      profile?.avatar_gender?.trim() &&
      profile?.telegram_bot_token?.trim() &&
      profile?.enrolment_completed_at &&
      profile?.avatar_glb_path?.trim() &&
      profile?.avatar_completed_at &&
      getSelectedProvisionTarget(profile) === "openclaw" &&
      profile?.openclaw_instance?.trim() &&
      profile?.openclaw_provision_completed_at &&
      profile?.openclaw_telegram_pair_completed_at &&
      profile?.onboarding_completed_at
  );
}

export function getRequiredOnboardingStep(
  profile: OnboardingProfile | null | undefined
): OnboardingStep | null {
  if (
    !profile?.owner_name?.trim() ||
    !profile.avatar_name?.trim() ||
    !profile.avatar_gender?.trim() ||
    !profile.telegram_bot_token?.trim() ||
    !profile.enrolment_completed_at
  ) {
    return "enrolment";
  }

  if (
    !profile.avatar_glb_path?.trim() ||
    !profile.avatar_completed_at
  ) {
    return "avatar";
  }

  if (getSelectedProvisionTarget(profile) !== "openclaw") {
    return "agent";
  }

  if (
    !profile.openclaw_instance?.trim() ||
    profile.openclaw_provision_status !== "ready" ||
    !profile.openclaw_provision_completed_at
  ) {
    return "provision";
  }

  if (
    profile.openclaw_telegram_pair_status !== "ready" ||
    !profile.openclaw_telegram_pair_completed_at ||
    !profile.onboarding_completed_at
  ) {
    return "approval";
  }

  return null;
}

export function parseOnboardingStep(value: string | null | undefined): OnboardingStep | null {
  if (value === "profile" || value === "telegram") {
    return "enrolment";
  }

  if (value === "pairing" || value === "telegram-pair") {
    return "approval";
  }

  return onboardingSteps.find((step) => step === value) ?? null;
}

export function getSelectedProvisionTarget(profile: OnboardingProfile | null | undefined) {
  const target = profile?.provision_target?.trim();

  if (target) {
    return target;
  }

  if (profile?.openclaw_instance?.trim() || profile?.openclaw_provision_status?.trim()) {
    return "openclaw";
  }

  return null;
}

export function onboardingPath(next = "/dashboard", step?: OnboardingStep) {
  const params = new URLSearchParams({ next });

  if (step) {
    params.set("step", step);
  }

  return `/onboarding?${params.toString()}`;
}
