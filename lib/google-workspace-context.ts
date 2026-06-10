import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import {
  getUserIdFromClaims,
  isOnboardingComplete,
  onboardingProfileSelect,
  type OnboardingProfile
} from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";

type GoogleWorkspaceProfile = OnboardingProfile & {
  google_workspace_enabled: boolean | null;
};

export class GoogleWorkspaceContextError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function getGoogleWorkspaceContext() {
  if (!hasSupabaseEnv()) {
    throw new GoogleWorkspaceContextError("Supabase is not configured", 503);
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(claimsData?.claims);

  if (claimsError || !userId) {
    throw new GoogleWorkspaceContextError("Authentication required", 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(`${onboardingProfileSelect},google_workspace_enabled`)
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    throw new GoogleWorkspaceContextError(profileError.message, 500);
  }

  const onboardingProfile = profile as GoogleWorkspaceProfile | null;

  if (!onboardingProfile || !isOnboardingComplete(onboardingProfile)) {
    throw new GoogleWorkspaceContextError("Onboarding required", 403);
  }

  const instance = onboardingProfile.openclaw_instance?.trim();

  if (!instance) {
    throw new GoogleWorkspaceContextError("OpenClaw instance is not available", 409);
  }

  if (!onboardingProfile.google_workspace_enabled) {
    throw new GoogleWorkspaceContextError("Google Workspace integration is disabled", 409);
  }

  return {
    instance,
    profile: onboardingProfile,
    supabase,
    userId
  };
}

export function googleWorkspaceApiError(error: unknown) {
  if (error instanceof GoogleWorkspaceContextError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : "google_workspace_request_failed";
  const status =
    message.startsWith("missing_gws_oauth") ||
    message.startsWith("missing_google_workspace_oauth")
      ? 503
      : message.includes("Paste ") ||
          message.includes("credentials") ||
          message.includes("callback") ||
          message.includes("code") ||
          message.includes("filename")
        ? 400
        : 500;

  return NextResponse.json({ error: message }, { status });
}
