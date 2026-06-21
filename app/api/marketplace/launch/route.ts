import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { workflowLaunchConfigById } from "@/lib/workflow-launch";
import { marketplaceItemById } from "@/lib/workflow-templates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProfileRow = {
  admin_deleted_at: string | null;
  admin_disabled: boolean | null;
  email: string | null;
};

type InstallRow = {
  id: string;
  item_id: string;
  item_type: string;
  status: string;
};

type LaunchClaims = {
  email?: string;
  exp: number;
  iat: number;
  install_id: string;
  iss: "2ndBrain.ceo";
  tool_id: string;
  user_id: string;
};

function cleanEnvValue(value: string | undefined) {
  const cleaned = value?.trim().replace(/^['"]|['"]$/g, "");

  return cleaned || null;
}

function launchTokenTtlSeconds() {
  const value = Number(cleanEnvValue(process.env.MARKETPLACE_LAUNCH_TOKEN_TTL_SECONDS) ?? "300");

  if (!Number.isFinite(value)) {
    return 300;
  }

  return Math.min(3600, Math.max(60, Math.trunc(value)));
}

function base64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function signLaunchToken(secret: string, claims: LaunchClaims) {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify(claims));
  const signature = base64Url(createHmac("sha256", secret).update(`${header}.${payload}`).digest());

  return `${header}.${payload}.${signature}`;
}

async function requireUser() {
  if (!hasSupabaseEnv()) {
    return {
      response: NextResponse.json({ error: "Supabase is not configured" }, { status: 503 })
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);
  const email = typeof data?.claims?.email === "string" ? data.claims.email.toLowerCase() : "";

  if (error || !userId) {
    return {
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 })
    };
  }

  return {
    email,
    response: null,
    userId
  };
}

export async function POST(request: Request) {
  const auth = await requireUser();

  if (auth.response) {
    return auth.response;
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required for marketplace launch" }, { status: 503 });
  }

  const payload = (await request.json().catch(() => null)) as { itemId?: unknown } | null;
  const itemId = typeof payload?.itemId === "string" ? payload.itemId.trim() : "";
  const item = marketplaceItemById(itemId);

  if (!item) {
    return NextResponse.json({ error: "Marketplace item was not found." }, { status: 404 });
  }

  const launchConfig = workflowLaunchConfigById(item.id);

  if (!launchConfig) {
    return NextResponse.json({ error: "This workflow tool does not support 2ndBrain launch yet." }, { status: 400 });
  }

  const appUrlValue = cleanEnvValue(process.env[launchConfig.appUrlEnv]);
  const secret = cleanEnvValue(process.env[launchConfig.secretEnv]);

  if (!appUrlValue) {
    return NextResponse.json({ error: `${launchConfig.appUrlEnv} is required for marketplace launch.` }, { status: 503 });
  }

  if (!secret) {
    return NextResponse.json({ error: `${launchConfig.secretEnv} is required for marketplace launch.` }, { status: 503 });
  }

  if (Buffer.byteLength(secret) < 32) {
    return NextResponse.json({ error: `${launchConfig.secretEnv} must be at least 32 bytes.` }, { status: 503 });
  }

  let launchUrl: URL;

  try {
    launchUrl = new URL(appUrlValue);
  } catch {
    return NextResponse.json({ error: `${launchConfig.appUrlEnv} must be a valid URL.` }, { status: 503 });
  }

  const adminSupabase = createAdminClient();
  const { data: profileRow, error: profileError } = await adminSupabase
    .from("profiles")
    .select("admin_deleted_at,admin_disabled,email")
    .eq("id", auth.userId)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (!profileRow) {
    return NextResponse.json({ error: "Profile was not found." }, { status: 404 });
  }

  const profile = profileRow as ProfileRow;

  if (profile.admin_disabled || profile.admin_deleted_at) {
    return NextResponse.json({ error: "Account access is disabled." }, { status: 403 });
  }

  const { data: installRow, error: installError } = await adminSupabase
    .from("marketplace_installs")
    .select("id,item_id,item_type,status")
    .eq("user_id", auth.userId)
    .eq("item_id", item.id)
    .neq("status", "uninstalled")
    .maybeSingle();

  if (installError) {
    return NextResponse.json({ error: installError.message }, { status: 500 });
  }

  if (!installRow) {
    return NextResponse.json({ error: "Install this workflow tool before launching it." }, { status: 404 });
  }

  const install = installRow as InstallRow;

  if (install.status === "disabled") {
    return NextResponse.json({ error: "This workflow tool is disabled until enough AI credits are available." }, { status: 423 });
  }

  if (install.status !== "installed") {
    return NextResponse.json({ error: "This workflow tool is not available to launch." }, { status: 409 });
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + launchTokenTtlSeconds();
  const token = signLaunchToken(secret, {
    email: auth.email || profile.email || undefined,
    exp: expiresAt,
    iat: issuedAt,
    install_id: install.id,
    iss: "2ndBrain.ceo",
    tool_id: launchConfig.toolId,
    user_id: auth.userId
  });

  launchUrl.searchParams.set("launch_token", token);

  return NextResponse.json(
    {
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      launchUrl: launchUrl.toString(),
      toolId: launchConfig.toolId
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
