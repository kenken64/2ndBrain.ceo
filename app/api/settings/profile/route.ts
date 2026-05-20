import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type SettingsUpdate = {
  googleWorkspaceEnabled?: unknown;
  profileName?: unknown;
};

function validateProfileName(value: unknown) {
  if (typeof value !== "string") {
    return {
      error: "Profile name must be text.",
      value: null
    };
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return {
      error: "Profile name is required.",
      value: null
    };
  }

  if (trimmed.length > 120) {
    return {
      error: "Profile name must be 120 characters or fewer.",
      value: null
    };
  }

  return {
    error: null,
    value: trimmed
  };
}

export async function PATCH(request: Request) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  let payload: SettingsUpdate;

  try {
    payload = (await request.json()) as SettingsUpdate;
  } catch {
    return NextResponse.json({ error: "Invalid settings payload." }, { status: 400 });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Invalid settings payload." }, { status: 400 });
  }

  const updates: Record<string, boolean | string> = {};

  if ("profileName" in payload) {
    const validation = validateProfileName(payload.profileName);

    if (validation.error || !validation.value) {
      return NextResponse.json({ error: validation.error ?? "Profile name is required." }, { status: 400 });
    }

    updates.profile_name = validation.value;
  }

  if ("googleWorkspaceEnabled" in payload) {
    if (typeof payload.googleWorkspaceEnabled !== "boolean") {
      return NextResponse.json({ error: "Google Workspace setting must be true or false." }, { status: 400 });
    }

    updates.google_workspace_enabled = payload.googleWorkspaceEnabled;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No settings were provided." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(claimsData?.claims);

  if (claimsError || !userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select("profile_name,google_workspace_enabled")
    .maybeSingle();

  if (error) {
    if (
      error.message.includes("profile_name") ||
      error.message.includes("google_workspace_enabled")
    ) {
      return NextResponse.json(
        { error: "Settings database columns are missing. Apply Supabase migration 0013_profile_settings.sql." },
        { status: 500 }
      );
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Profile was not found." }, { status: 404 });
  }

  return NextResponse.json({
    googleWorkspaceEnabled: Boolean(data.google_workspace_enabled),
    ok: true,
    profileName: typeof data.profile_name === "string" ? data.profile_name : ""
  });
}
