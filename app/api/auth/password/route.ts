import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getIncomingRequestOrigin, getRequestOrigin, safeNextPath } from "@/lib/url";

export const runtime = "nodejs";
const errorResponse = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!hasSupabaseEnv()) return errorResponse("Sign-in is not configured yet.", 503);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host");
  const origin = request.headers.get("origin");
  if (!origin || !host || (() => { try { return new URL(origin).host !== host || new URL(origin).origin !== getIncomingRequestOrigin(request); } catch { return true; } })()) return errorResponse("Invalid request origin.", 403);
  if (getIncomingRequestOrigin(request) !== getRequestOrigin(request)) return errorResponse("Please open the main website before signing in.", 409);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !request.body) return errorResponse("Invalid request.", 400);
  let body: { action?: unknown; email?: unknown; password?: unknown; next?: unknown };
  try {
    const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 16_384) { await reader.cancel(); return errorResponse("Request is too large.", 413); } chunks.push(part.value); }
    body = JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size).toString("utf8"));
  } catch { return errorResponse("Invalid request.", 400); }
  const action = body?.action;
  if (!["login", "signup", "recover", "update"].includes(typeof action === "string" ? action : "")) return errorResponse("Invalid request.", 400);
  const next = safeNextPath(typeof body.next === "string" ? body.next : null, "/dashboard/chat");
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (action !== "update" && (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return errorResponse("Enter a valid email address.", 400);
  if (action !== "recover" && (!password || password.length > 128 || (action !== "login" && password.length < 8))) return errorResponse(action === "login" ? "Enter your password." : "Use a password between 8 and 128 characters.", 400);
  const supabase = await createClient();
  if (action === "update") {
    const { data, error } = await supabase.auth.getClaims();
    if (error || typeof data?.claims?.sub !== "string") return errorResponse("Your recovery session has expired. Request a new reset link.", 401);
    const result = await supabase.auth.updateUser({ password });
    if (result.error) return errorResponse("Could not update your password. Check the password requirements and try again.", 400);
    return NextResponse.json({ redirectTo: `/login?next=${encodeURIComponent(next)}` });
  }
  if (action === "recover") {
    const callback = new URL("/auth/callback", getRequestOrigin(request));
    callback.searchParams.set("flow", "recovery"); callback.searchParams.set("next", next); callback.searchParams.set("callback_origin", callback.origin);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callback.toString() });
    if (error) return errorResponse("Could not send the reset email. Please try again later.", error.status === 429 ? 429 : 400);
    return NextResponse.json({ message: "If an account exists for that email, a password reset link has been sent. Open it in this browser." });
  }
  if (action === "signup") {
    const callback = new URL("/auth/callback", getRequestOrigin(request));
    callback.searchParams.set("flow", "email_signup"); callback.searchParams.set("next", next); callback.searchParams.set("callback_origin", callback.origin);
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: callback.toString() } });
    if (error) {
      if (error.code === "user_already_exists" || error.code === "email_exists") return NextResponse.json({ message: "If the address can be registered, check your email for a confirmation link. Open it in this browser." });
      return errorResponse(error.status === 429 ? "Too many attempts. Please wait and try again." : "Could not create the account. Check your details and try again.", error.status === 429 ? 429 : 400);
    }
    if (data.session && data.user) {
      await supabase.from("profiles").upsert({ id: data.user.id, ...(data.user.email ? { email: data.user.email } : {}) }, { onConflict: "id" });
      return NextResponse.json({ redirectTo: `/login?next=${encodeURIComponent(next)}` });
    }
    return NextResponse.json({ message: "If the address can be registered, check your email for a confirmation link. Open it in this browser." });
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return errorResponse(error?.status === 429 ? "Too many attempts. Please wait and try again." : "Unable to sign in. Check your email, password, and email confirmation.", error?.status === 429 ? 429 : 401);
  await supabase.from("profiles").upsert({ id: data.user.id, ...(data.user.email ? { email: data.user.email } : {}) }, { onConflict: "id" });
  return NextResponse.json({ redirectTo: `/login?next=${encodeURIComponent(next)}` });
}
