import { after, NextResponse } from "next/server";
import { isAdminUser } from "@/lib/admin";
import { hasSupabaseEnv } from "@/lib/env";
import {
  getUserIdFromClaims,
  isOnboardingComplete,
  onboardingPath,
  onboardingProfileSelect,
  type OnboardingProfile
} from "@/lib/onboarding";
import { generateOpenClawWikiProject } from "@/lib/openclaw";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { publishTokenQuotaUpdate } from "@/lib/token-quota-redis";
import { appUrl, safeNextPath } from "@/lib/url";
import { convertWikiAttachments } from "@/lib/wiki-attachments";

export const runtime = "nodejs";
export const maxDuration = 900;

function titleFromPrompt(prompt: string) {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  if (!cleaned) {
    return "Untitled project";
  }

  return cleaned.length > 64 ? `${cleaned.slice(0, 61)}...` : cleaned;
}

function slugFromProjectId(projectId: string) {
  const hexId = projectId.replace(/-/g, "");
  const numericId = BigInt(`0x${hexId}`).toString(10);

  return `wiki-${numericId}`;
}

function outputSummary(value: string) {
  return value.slice(-4000);
}

function estimateProjectTokenCost(prompt: string, files: File[]) {
  const promptTokens = Math.ceil(prompt.trim().length / 4);
  const fileTokens = Math.ceil(files.reduce((sum, file) => sum + file.size, 0) / 4);

  return Math.max(1, 1000 + promptTokens + fileTokens);
}

function projectGenerationErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.startsWith("missing_") ? message : "project_generation";
}

function redirectWithParams(request: Request, path: string, params: Record<string, string>) {
  const url = appUrl(path, request);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return NextResponse.redirect(url, { status: 303 });
}

async function requireUser() {
  if (!hasSupabaseEnv()) {
    return {
      supabase: null,
      response: NextResponse.json({ error: "Supabase is not configured" }, { status: 503 })
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  const userId = getUserIdFromClaims(data?.claims);
  const email = typeof data?.claims?.email === "string" ? data.claims.email.toLowerCase() : null;

  if (error || !userId) {
    return {
      supabase: null,
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 })
    };
  }

  return {
    email,
    supabase,
    userId,
    response: null
  };
}

export async function GET() {
  const auth = await requireUser();

  if (auth.response) {
    return auth.response;
  }

  const { data, error } = await auth.supabase
    .from("projects")
    .select("id,title,prompt,status,created_at")
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ projects: data });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  const contentType = request.headers.get("content-type") ?? "";
  const isFormPost = contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");

  if (auth.response) {
    if (isFormPost) {
      return NextResponse.redirect(appUrl("/login?next=/dashboard", request), {
        status: 303
      });
    }

    return auth.response;
  }

  const payload = isFormPost ? await request.formData() : await request.json();
  const prompt =
    payload instanceof FormData
      ? String(payload.get("prompt") ?? "")
      : String(payload.prompt ?? "");
  const returnTo =
    payload instanceof FormData
      ? safeNextPath(String(payload.get("returnTo") ?? "/dashboard"))
      : "/dashboard";

  if (!prompt.trim()) {
    if (isFormPost) {
      return redirectWithParams(request, returnTo, { error: "empty_prompt" });
    }

    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }

  const { data: profile, error: profileError } = await auth.supabase
    .from("profiles")
    .select(`${onboardingProfileSelect},admin_disabled,admin_deleted_at,llm_token_quota,llm_token_used`)
    .eq("id", auth.userId)
    .maybeSingle();
  const onboardingProfile = profile as (OnboardingProfile & {
    admin_deleted_at?: string | null;
    admin_disabled?: boolean | null;
    llm_token_quota?: number | null;
    llm_token_used?: number | null;
  }) | null;

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (!isOnboardingComplete(onboardingProfile)) {
    if (isFormPost) {
      return NextResponse.redirect(
        appUrl(onboardingPath(`/intent?prompt=${encodeURIComponent(prompt.trim())}`), request),
        { status: 303 }
      );
    }

    return NextResponse.json({ error: "Onboarding required" }, { status: 403 });
  }

  if (onboardingProfile?.admin_disabled || onboardingProfile?.admin_deleted_at) {
    return NextResponse.json({ error: "Account access is disabled" }, { status: 403 });
  }

  const openclawInstance = onboardingProfile?.openclaw_instance?.trim();
  const ownerName = onboardingProfile?.owner_name?.trim();
  const avatarName = onboardingProfile?.avatar_name?.trim();

  if (!openclawInstance || !ownerName || !avatarName) {
    if (isFormPost) {
      return redirectWithParams(request, returnTo, { error: "openclaw_profile" });
    }

    return NextResponse.json({ error: "OpenClaw profile is incomplete" }, { status: 409 });
  }

  const attachmentInputs =
    payload instanceof FormData
      ? payload.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0)
      : [];
  const estimatedTokenCost = estimateProjectTokenCost(prompt, attachmentInputs);

  if (!hasSupabaseServiceRoleEnv()) {
    if (isFormPost) {
      return redirectWithParams(request, returnTo, { error: "token_quota_unavailable" });
    }

    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required for token quota enforcement" }, { status: 503 });
  }

  const adminSupabase = createAdminClient();
  const { data: quotaProfile, error: quotaProfileError } = await adminSupabase
    .from("profiles")
    .select("admin_disabled,admin_deleted_at,email,llm_token_quota,llm_token_used")
    .eq("id", auth.userId)
    .maybeSingle();

  if (quotaProfileError) {
    if (isFormPost) {
      return redirectWithParams(request, returnTo, { error: "token_quota_profile" });
    }

    return NextResponse.json({ error: quotaProfileError.message }, { status: 500 });
  }

  const quota = Number(quotaProfile?.llm_token_quota ?? 0);
  const used = Number(quotaProfile?.llm_token_used ?? 0);
  const remaining = quota - used;
  const isAdmin = await isAdminUser(auth.email, auth.userId);

  if (quotaProfile?.admin_disabled || quotaProfile?.admin_deleted_at) {
    if (isFormPost) {
      return NextResponse.redirect(appUrl("/disabled", request), { status: 303 });
    }

    return NextResponse.json({ error: "Account access is disabled" }, { status: 403 });
  }

  if (!isAdmin && (quota <= 0 || remaining < estimatedTokenCost)) {
    if (isFormPost) {
      return redirectWithParams(request, returnTo, { error: "token_quota_exceeded" });
    }

    return NextResponse.json(
      {
        error: "LLM token quota exceeded",
        estimatedTokenCost,
        remaining: Math.max(0, remaining)
      },
      { status: 402 }
    );
  }

  const { error: usageError } = isAdmin
    ? { error: null }
    : await adminSupabase
        .from("profiles")
        .update({
          llm_token_used: used + estimatedTokenCost
        })
        .eq("id", auth.userId);

  if (usageError) {
    if (isFormPost) {
      return redirectWithParams(request, returnTo, { error: "token_quota_update" });
    }

    return NextResponse.json({ error: usageError.message }, { status: 500 });
  }

  if (!isAdmin) {
    await publishTokenQuotaUpdate({
      actorUserId: auth.userId,
      deltaTokens: -estimatedTokenCost,
      email: quotaProfile?.email ?? null,
      llmTokenQuota: quota,
      llmTokenUsed: used + estimatedTokenCost,
      metadata: {
        estimatedTokenCost
      },
      reason: "project_token_usage",
      userId: auth.userId
    });
  }

  const { data, error } = await auth.supabase
    .from("projects")
    .insert({
      user_id: auth.userId,
      title: titleFromPrompt(prompt),
      prompt,
      status: "running"
    })
    .select("id,title,prompt,status,created_at")
    .single();

  if (error) {
    if (isFormPost) {
      return redirectWithParams(request, returnTo, { error: "project_insert" });
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const projectSlug = slugFromProjectId(data.id);

  await auth.supabase
    .from("projects")
    .update({
      openclaw_generation_started_at: new Date().toISOString(),
      openclaw_instance: openclawInstance,
      openclaw_project_slug: projectSlug
    })
    .eq("id", data.id);

  after(async () => {
    try {
      const attachments = await convertWikiAttachments(attachmentInputs);
      const generated = await generateOpenClawWikiProject({
        avatarName,
        attachments,
        instance: openclawInstance,
        ownerName,
        projectId: data.id,
        projectSlug,
        prompt: prompt.trim(),
        userId: auth.userId
      });

      await auth.supabase
        .from("projects")
        .update({
          openclaw_generation_completed_at: new Date().toISOString(),
          openclaw_generation_error: null,
          openclaw_generation_mapping: generated.mapping,
          openclaw_generation_output: outputSummary(
            [generated.hooksOutput, generated.sendOutput].filter(Boolean).join("\n\n")
          ),
          openclaw_generation_prompt: generated.task,
          status: "ready"
        })
        .eq("id", data.id);
    } catch (generationError) {
      const message =
        generationError instanceof Error ? generationError.message : "project_generation";

      await auth.supabase
        .from("projects")
        .update({
          openclaw_generation_completed_at: new Date().toISOString(),
          openclaw_generation_error: outputSummary(message),
          status: "failed"
        })
        .eq("id", data.id);
    }
  });

  if (isFormPost) {
    return redirectWithParams(request, returnTo, { created: "1" });
  }

  return NextResponse.json({ project: data }, { status: 202 });
}
