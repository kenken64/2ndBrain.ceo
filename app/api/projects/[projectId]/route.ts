import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { deleteOpenClawWikiProject } from "@/lib/openclaw";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ProjectRouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type ProjectDeleteRow = {
  created_at: string;
  id: string;
  openclaw_project_slug: string | null;
  status: string;
  title: string;
};

const STALE_RUNNING_PROJECT_MS = 60 * 60 * 1000;

function outputSummary(value: string) {
  return value.slice(-4000);
}

function isAlreadyDeleted(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("not found") ||
    message.includes("no such file") ||
    message.includes("does not exist")
  );
}

function isStaleRunningProject(project: ProjectDeleteRow) {
  if (project.status !== "running") {
    return false;
  }

  const createdAt = new Date(project.created_at).getTime();

  return Number.isFinite(createdAt) && Date.now() - createdAt > STALE_RUNNING_PROJECT_MS;
}

function shouldSkipRemoteWikiDelete(project: ProjectDeleteRow) {
  return project.status === "failed" || isStaleRunningProject(project);
}

export async function DELETE(_request: Request, context: ProjectRouteContext) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const { projectId } = await context.params;
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(claimsData?.claims);

  if (claimsError || !userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("openclaw_instance")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("created_at,id,title,status,openclaw_project_slug")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (projectError) {
    return NextResponse.json({ error: projectError.message }, { status: 500 });
  }

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const wikiProject = project as ProjectDeleteRow;
  const projectSlug = wikiProject.openclaw_project_slug?.trim();
  const instance = typeof profile?.openclaw_instance === "string" ? profile.openclaw_instance.trim() : "";
  let openclawDeleteOutput: string | null = null;

  if (projectSlug) {
    if (shouldSkipRemoteWikiDelete(wikiProject)) {
      openclawDeleteOutput =
        `Skipped OpenClaw cleanup for ${projectSlug} because this project is ${wikiProject.status} or stale.`;
    } else if (!instance) {
      return NextResponse.json({ error: "OpenClaw instance is not available" }, { status: 409 });
    } else {
      try {
        const deleted = await deleteOpenClawWikiProject({
          instance,
          projectSlug
        });

        openclawDeleteOutput = deleted.output;
      } catch (error) {
        if (!isAlreadyDeleted(error)) {
          const message = error instanceof Error ? error.message : "openclaw_wiki_delete_failed";

          return NextResponse.json({ error: outputSummary(message) }, { status: 500 });
        }

        openclawDeleteOutput = `OpenClaw wiki project ${projectSlug} was already missing.`;
      }
    }
  }

  const { error: deleteError } = await supabase
    .from("projects")
    .delete()
    .eq("id", wikiProject.id)
    .eq("user_id", userId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({
    deletedProjectId: wikiProject.id,
    openclawDeleteOutput: outputSummary(openclawDeleteOutput ?? "No OpenClaw folder was attached to this project."),
    ok: true
  });
}
