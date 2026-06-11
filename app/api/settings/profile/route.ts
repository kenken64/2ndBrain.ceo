import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { updateGyneConsumerProfile } from "@/lib/openclaw";
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

function outputSummary(value: string) {
  return value.slice(-1200);
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

  const updates: Record<string, boolean | string | null> = {};

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

    if (!payload.googleWorkspaceEnabled) {
      updates.google_workspace_connected_at = null;
    }
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

  const profileName = typeof updates.profile_name === "string" ? updates.profile_name : null;

  if (profileName) {
    const { data: currentProfile, error: currentProfileError } = await supabase
      .from("profiles")
      .select("openclaw_instance")
      .eq("id", userId)
      .maybeSingle();

    if (currentProfileError) {
      return NextResponse.json({ error: currentProfileError.message }, { status: 500 });
    }

    const openClawInstance =
      typeof currentProfile?.openclaw_instance === "string"
        ? currentProfile.openclaw_instance.trim()
        : "";

    if (!openClawInstance) {
      return NextResponse.json(
        { error: "OpenClaw instance is required before updating the Gyne consumer profile." },
        { status: 409 }
      );
    }

    try {
      await updateGyneConsumerProfile({
        instance: openClawInstance,
        name: profileName
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "gyne_consumer_profile_update_failed";

      return NextResponse.json(
        { error: `Gyne consumer profile could not be updated: ${outputSummary(message)}` },
        { status: 502 }
      );
    }
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
