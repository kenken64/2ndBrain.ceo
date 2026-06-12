import { NextResponse } from "next/server";
import { isAdminUser } from "@/lib/admin";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RecipientRow = {
  display_name: string | null;
  email: string;
  user_id: string;
};

function normalizeEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase() ?? "";

  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }

  return email;
}

function rpcErrorResponse(error: { message?: string }) {
  const message = error.message ?? "recipient_lookup_failed";

  if (message.includes("recipient_email_required")) {
    return NextResponse.json({ error: "Recipient email is required." }, { status: 400 });
  }

  if (message.includes("recipient_is_sender")) {
    return NextResponse.json({ error: "Choose another user to receive AI credits." }, { status: 409 });
  }

  if (message.includes("recipient_email_ambiguous")) {
    return NextResponse.json({ error: "More than one profile uses that email address." }, { status: 409 });
  }

  return NextResponse.json({ error: "Recipient lookup failed." }, { status: 500 });
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

  if (error || !userId) {
    return {
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 })
    };
  }

  return {
    response: null,
    userId
  };
}

export async function GET(request: Request) {
  const auth = await requireUser();

  if (auth.response) {
    return auth.response;
  }

  if (!hasSupabaseServiceRoleEnv()) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required for credit transfers" }, { status: 503 });
  }

  const requestUrl = new URL(request.url);
  const email = normalizeEmail(requestUrl.searchParams.get("email"));

  if (!email) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  if (await isAdminUser(email, null)) {
    return NextResponse.json({ error: "Admin accounts are exempt from AI credit quotas." }, { status: 409 });
  }

  const { data, error } = await createAdminClient()
    .rpc("find_ai_credit_transfer_recipient", {
      p_recipient_email: email,
      p_sender_user_id: auth.userId
    })
    .maybeSingle();

  if (error) {
    return rpcErrorResponse(error);
  }

  const recipient = data as RecipientRow | null;

  if (!recipient) {
    return NextResponse.json({ error: "No user found with that email address." }, { status: 404 });
  }

  return NextResponse.json({
    recipient: {
      displayName: recipient.display_name,
      email: recipient.email,
      userId: recipient.user_id
    }
  });
}
