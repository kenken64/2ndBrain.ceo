import "server-only";

import { redirect } from "next/navigation";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type AdminAccessOptions = {
  next?: string;
  requireMfa?: boolean;
  requireServiceRole?: boolean;
};

type AdminAccessFailureReason =
  | "admin_forbidden"
  | "admin_mfa_required"
  | "authentication_required"
  | "missing_supabase_service_role_key"
  | "supabase_not_configured";

export type AdminAccessResult =
  | {
      adminSupabase: ReturnType<typeof createAdminClient> | null;
      aal: string | null;
      email: string;
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      userId: string;
    }
  | {
      aal?: string | null;
      email?: string;
      message: string;
      ok: false;
      reason: AdminAccessFailureReason;
      status: number;
      userId?: string;
    };

export async function isAdminUser(email: string | null | undefined, userId: string | null | undefined) {
  const normalizedEmail = email?.trim().toLowerCase() ?? "";
  const normalizedUserId = userId?.trim() ?? "";

  if ((!normalizedEmail && !normalizedUserId) || !hasSupabaseServiceRoleEnv()) {
    return false;
  }

  const adminSupabase = createAdminClient();
  let query = adminSupabase
    .from("admin_users")
    .select("id")
    .eq("enabled", true);

  if (normalizedEmail && normalizedUserId) {
    query = query.or(`email.eq.${normalizedEmail},user_id.eq.${normalizedUserId}`);
  } else if (normalizedEmail) {
    query = query.eq("email", normalizedEmail);
  } else {
    query = query.eq("user_id", normalizedUserId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    return false;
  }

  return Boolean(data);
}

export async function canShowAdminWorkspaceLink(input?: { email?: string | null; userId?: string | null }) {
  const email = input?.email?.trim().toLowerCase();
  const userId = input?.userId?.trim();

  if (email && userId) {
    return isAdminUser(email, userId);
  }

  const access = await getAdminAccess({
    requireMfa: false,
    requireServiceRole: false
  });

  return access.ok;
}

export async function getAdminAccess(options: AdminAccessOptions = {}): Promise<AdminAccessResult> {
  const requireMfa = options.requireMfa ?? true;
  const requireServiceRole = options.requireServiceRole ?? true;

  if (!hasSupabaseEnv()) {
    return {
      message: "Supabase is not configured.",
      ok: false,
      reason: "supabase_not_configured",
      status: 503
    };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(claimsData?.claims);
  const email = typeof claimsData?.claims?.email === "string" ? claimsData.claims.email.toLowerCase() : "";

  if (claimsError || !userId || !email) {
    return {
      message: "Authentication required.",
      ok: false,
      reason: "authentication_required",
      status: 401
    };
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return {
      email,
      message: "SUPABASE_SERVICE_ROLE_KEY is required for admin controls.",
      ok: false,
      reason: "missing_supabase_service_role_key",
      status: 503,
      userId
    };
  }

  if (!(await isAdminUser(email, userId))) {
    return {
      email,
      message: "Admin access required.",
      ok: false,
      reason: "admin_forbidden",
      status: 403,
      userId
    };
  }

  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const aal = aalData?.currentLevel ?? null;

  if (requireMfa && aal !== "aal2") {
    return {
      aal,
      email,
      message: "Admin TOTP verification required.",
      ok: false,
      reason: "admin_mfa_required",
      status: 403,
      userId
    };
  }

  if (requireServiceRole && !hasSupabaseServiceRoleEnv()) {
    return {
      message: "SUPABASE_SERVICE_ROLE_KEY is required for admin controls.",
      ok: false,
      reason: "missing_supabase_service_role_key",
      status: 503
    };
  }

  return {
    adminSupabase: hasSupabaseServiceRoleEnv() ? createAdminClient() : null,
    aal,
    email,
    ok: true,
    supabase,
    userId
  };
}

export async function requireAdminPage(options: AdminAccessOptions = {}) {
  const next = options.next ?? "/admin";
  const access = await getAdminAccess(options);

  if (access.ok) {
    return access;
  }

  if (access.reason === "authentication_required") {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (access.reason === "admin_mfa_required") {
    redirect(`/admin/mfa?next=${encodeURIComponent(next)}`);
  }

  return access;
}

export async function logAdminAudit(
  adminSupabase: ReturnType<typeof createAdminClient>,
  input: {
    action: string;
    adminEmail: string;
    adminUserId: string;
    details?: Record<string, unknown>;
    status?: "success" | "failed";
    targetEmail?: string | null;
    targetUserId?: string | null;
  }
) {
  await adminSupabase.from("admin_audit_events").insert({
    action: input.action,
    admin_email: input.adminEmail,
    admin_user_id: input.adminUserId,
    details: input.details ?? {},
    status: input.status ?? "success",
    target_email: input.targetEmail ?? null,
    target_user_id: input.targetUserId ?? null
  });
}
