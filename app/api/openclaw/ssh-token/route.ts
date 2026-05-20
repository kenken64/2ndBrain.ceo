import { createHmac, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getWikiContext, wikiApiError } from "@/lib/wiki-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SSH_TOKEN_TTL_SECONDS = 60;

function cleanEnv(value: string | undefined) {
  return value?.trim().replace(/^['"]|['"]$/g, "") || null;
}

function firstEnv(names: string[]) {
  for (const name of names) {
    const value = cleanEnv(process.env[name]);

    if (value) {
      return value;
    }
  }

  return null;
}

function optionalPositiveNumber(name: string, fallback: number) {
  const configured = Number(process.env[name] ?? "");
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function sshTokenSecret() {
  const secret = firstEnv([
    "OPENCLAW_SSH_TOKEN_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_JWT_SECRET",
    "SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  ]);

  if (!secret) {
    throw new Error("missing_openclaw_ssh_token_secret");
  }

  return secret;
}

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function signPayload(encodedPayload: string) {
  return createHmac("sha256", sshTokenSecret()).update(encodedPayload).digest("base64url");
}

function createSshToken(input: {
  instance: string;
  userId: string;
}) {
  const ttlSeconds = optionalPositiveNumber("OPENCLAW_SSH_TOKEN_TTL_SECONDS", DEFAULT_SSH_TOKEN_TTL_SECONDS);
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    exp: issuedAt + ttlSeconds,
    iat: issuedAt,
    instance: input.instance,
    nonce: randomBytes(16).toString("base64url"),
    sub: input.userId
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);

  return {
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    token: `${encodedPayload}.${signature}`
  };
}

export async function POST() {
  try {
    const context = await getWikiContext(null, { selectLatest: false });
    const token = createSshToken({
      instance: context.instance,
      userId: context.userId
    });

    return NextResponse.json(token);
  } catch (error) {
    return wikiApiError(error);
  }
}
