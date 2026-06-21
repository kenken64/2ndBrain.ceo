import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import {
  getUserIdFromClaims,
  isOnboardingComplete,
  onboardingProfileSelect,
  type OnboardingProfile
} from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";

export type WikiProject = {
  id: string;
  openclaw_project_slug: string | null;
  prompt: string | null;
  status: string;
  title: string;
};

export type WikiContext = {
  instance: string;
  profile: OnboardingProfile;
  project: WikiProject | null;
  projectSlug: string | null;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
};

export class WikiContextError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function getWikiContext(
  projectId?: string | null,
  options: { selectLatest?: boolean } = {}
): Promise<WikiContext> {
  if (!hasSupabaseEnv()) {
    throw new WikiContextError("Supabase is not configured", 503);
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(claimsData?.claims);

  if (claimsError || !userId) {
    throw new WikiContextError("Authentication required", 401);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(onboardingProfileSelect)
    .eq("id", userId)
    .maybeSingle();
  const onboardingProfile = profile as OnboardingProfile | null;

  if (!onboardingProfile || !isOnboardingComplete(onboardingProfile)) {
    throw new WikiContextError("Onboarding required", 403);
  }

  const instance = onboardingProfile?.openclaw_instance?.trim();

  if (!instance) {
    throw new WikiContextError("OpenClaw instance is not available", 409);
  }

  if (onboardingProfile.openclaw_tokens_paused) {
    throw new WikiContextError("OpenClaw AI usage is paused. Resume AI usage in Settings before continuing.", 423);
  }

  let project: WikiProject | null = null;

  if (projectId) {
    const { data } = await supabase
      .from("projects")
      .select("id,title,prompt,status,openclaw_project_slug")
      .eq("user_id", userId)
      .eq("id", projectId)
      .maybeSingle();

    project = (data as WikiProject | null) ?? null;
  } else if (options.selectLatest !== false) {
    const { data } = await supabase
      .from("projects")
      .select("id,title,prompt,status,openclaw_project_slug")
      .eq("user_id", userId)
      .eq("status", "ready")
      .not("openclaw_project_slug", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    project = (data as WikiProject | null) ?? null;
  }

  return {
    instance,
    profile: onboardingProfile,
    project,
    projectSlug: project?.openclaw_project_slug ?? null,
    supabase,
    userId
  };
}

export function wikiApiError(error: unknown) {
  if (error instanceof WikiContextError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : "wiki_request_failed";
  const status = message === "invalid_wiki_path" ? 400 : 500;

  return NextResponse.json({ error: message }, { status });
}
