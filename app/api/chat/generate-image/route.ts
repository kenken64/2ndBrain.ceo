import { NextResponse } from "next/server";
import { isAdminUser } from "@/lib/admin";
import { saveChatGeneratedImage } from "@/lib/chat-files";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { publishTokenQuotaUpdate } from "@/lib/token-quota-redis";

export const runtime = "nodejs";
export const maxDuration = 120;
const MODEL = "bytedance-seed/seedream-4.5";
const CREDITS_PER_USD = 250_000;
const errorResponse = (error: string, status: number) => NextResponse.json({ error }, { status });
type CreditRow = { request_id?: string; llm_token_quota: number | string; llm_token_used: number | string; charged_credits?: number | string };

async function reservationForImage(apiKey: string) {
  const response = await fetch(`https://openrouter.ai/api/v1/images/models/${MODEL}/endpoints`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  const catalog = await response.json() as { endpoints?: Array<{ pricing?: Array<{ billable?: unknown; unit?: unknown; cost_usd?: unknown; variants?: unknown }> }> };
  if (!response.ok || !catalog.endpoints?.length) throw new Error("pricing unavailable");
  const prices = catalog.endpoints.map(endpoint => {
    if (!Array.isArray(endpoint.pricing)) throw new Error("unsupported pricing");
    const output = endpoint.pricing.filter(line => line.billable === "output_image");
    if (output.length !== 1 || endpoint.pricing.some(line => line.billable !== "output_image" && line.billable !== "input_image")) throw new Error("unsupported pricing");
    const line = output[0];
    const price = Number(line.cost_usd);
    if (line.billable !== "output_image" || line.unit !== "image" || (line.variants != null && (!Array.isArray(line.variants) || line.variants.length > 0)) || !Number.isFinite(price) || price <= 0) throw new Error("unsupported pricing");
    return price;
  });
  return Math.max(1, Math.ceil(Math.max(...prices) * CREDITS_PER_USD));
}

export async function GET() {
  if (!hasSupabaseEnv() || !process.env.OPENROUTER_API_KEY?.trim()) return errorResponse("Image generation is not configured.", 503);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !getUserIdFromClaims(data?.claims)) return errorResponse("Please log in to generate images.", 401);
  try {
    const credits = await reservationForImage(process.env.OPENROUTER_API_KEY.trim());
    return NextResponse.json({ model: MODEL, credits, estimatedUsd: credits / CREDITS_PER_USD }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return errorResponse("Image pricing is temporarily unavailable. Please try again later.", 503); }
}

export async function POST(request: Request) {
  if (!hasSupabaseEnv() || !hasSupabaseServiceRoleEnv() || !process.env.OPENROUTER_API_KEY?.trim()) return errorResponse("Image generation is not configured.", 503);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);
  if (error || !userId) return errorResponse("Please log in to generate images.", 401);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host");
  const origin = request.headers.get("origin");
  if (origin && (!host || (() => { try { return new URL(origin).host !== host; } catch { return true; } })())) return errorResponse("Invalid request origin.", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return errorResponse("Invalid request.", 400);
  let body: { prompt?: unknown };
  try {
    if (!request.body) throw new Error("empty");
    const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 64_000) { await reader.cancel(); return errorResponse("Request is too large.", 413); } chunks.push(part.value); }
    body = JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size).toString("utf8"));
  } catch { return errorResponse("Invalid request.", 400); }
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > 10_000) return errorResponse("Enter an image prompt of up to 10,000 characters.", 400);
  const apiKey = process.env.OPENROUTER_API_KEY.trim();
  let reserve: number;
  try {
    reserve = await reservationForImage(apiKey);
  } catch { return errorResponse("Image pricing is temporarily unavailable. Please try again later.", 503); }
  const admin = createAdminClient();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  const isAdmin = await isAdminUser(email, userId);
  const { data: profile, error: profileError } = await admin.from("profiles").select("email,openclaw_instance").eq("id", userId).maybeSingle();
  if (profileError || !profile) return errorResponse("Unable to check your account.", 503);
  const { data: reserved, error: reserveError } = await admin.rpc("reserve_chat_credits_itemized", { p_user_id: userId, p_model_id: MODEL, p_credits: reserve, p_is_admin: isAdmin, p_kind: "image_generation", p_pdf_pages: null }).single();
  const reservation = reserved as CreditRow | null;
  if (reserveError || !reservation?.request_id) return errorResponse(reserveError?.message?.includes("insufficient_ai_credits") ? `This image needs a reservation of ${reserve.toLocaleString("en")} AI credits.` : "Chat credit accounting is unavailable.", reserveError?.message?.includes("insufficient_ai_credits") ? 402 : 503);
  const requestId = reservation.request_id;
  const notify = async (row: CreditRow, reason: "chat_credit_reservation" | "chat_credit_settlement") => { if (!isAdmin) await publishTokenQuotaUpdate({ userId, actorUserId: userId, email: email || profile.email, openclawInstance: profile.openclaw_instance, llmTokenQuota: Number(row.llm_token_quota), llmTokenUsed: Number(row.llm_token_used), reason, metadata: { chatRequestId: requestId } }); };
  await notify(reservation, "chat_credit_reservation");
  let providerId: string | null = null; let settled = false;
  const settle = async (status: "completed" | "failed" | "uncertain", cost: number | null) => {
    const { data: result, error: settlementError } = await admin.rpc("settle_chat_credits_itemized", { p_user_id: userId, p_request_id: requestId, p_status: status, p_actual_credits: status === "completed" && cost !== null ? Math.ceil(cost * CREDITS_PER_USD) : 0, p_cost_usd: cost, p_provider_request_id: providerId, p_prompt_tokens: null, p_completion_tokens: null }).single();
    if (settlementError || !result) return null;
    settled = true; const row = result as CreditRow; await notify(row, "chat_credit_settlement"); return row;
  };
  try {
    const response = await fetch("https://openrouter.ai/api/v1/images", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "AI CUBER" }, signal: AbortSignal.timeout(110_000), body: JSON.stringify({ model: MODEL, prompt, n: 1 }) });
    if (!response.ok) {
      providerId = response.headers.get("x-generation-id");
      const status = response.status >= 400 && response.status < 500 && response.status !== 408 ? "failed" : "uncertain";
      const result = await settle(status, null);
      return errorResponse(result && status === "failed" ? "Image generation was rejected. Please try another prompt." : "Image generation could not be confirmed; reserved credits are held for review.", 502);
    }
    const reader = response.body?.getReader(); if (!reader) throw new Error("empty response");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 30 * 1024 * 1024) { await reader.cancel(); throw new Error("response too large"); } chunks.push(part.value); }
    const result = JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size).toString("utf8")) as { id?: unknown; data?: Array<{ b64_json?: unknown; media_type?: unknown }>; usage?: { cost?: unknown } };
    providerId = typeof result.id === "string" ? result.id : null;
    const cost = typeof result.usage?.cost === "number" && Number.isFinite(result.usage.cost) && result.usage.cost >= 0 ? result.usage.cost : null;
    const billed = await settle(cost === null ? "uncertain" : "completed", cost);
    const image = result.data?.[0];
    if (typeof image?.b64_json !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.b64_json)) return errorResponse("The provider returned an invalid image. Check AI Credits Usage before retrying.", 502);
    try {
      const bytes = Buffer.from(image.b64_json, "base64");
      const mime = typeof image.media_type === "string" ? image.media_type : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png" : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg" : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" ? "image/webp" : "";
      const output = await saveChatGeneratedImage(admin, userId, bytes, mime);
      return NextResponse.json({ message: "Your image is ready. Open it to preview or download it from My Files.", savedOutput: output, usagePending: cost === null || !billed, ...(billed && cost !== null ? { chargedCredits: Number(billed.charged_credits ?? 0), availableCredits: Math.max(0, Number(billed.llm_token_quota) - Number(billed.llm_token_used)) } : {}), quotaExempt: isAdmin });
    } catch { return errorResponse("The provider charged for the image, but it could not be saved. See AI Credits Usage.", 503); }
  } catch {
    if (!settled) await settle("uncertain", null).catch(() => null);
    return errorResponse("Image generation could not be confirmed. Check AI Credits Usage before retrying.", 502);
  }
}
