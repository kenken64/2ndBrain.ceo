import { NextResponse } from "next/server";
import { isAdminUser } from "@/lib/admin";
import { saveChatGeneratedVideo } from "@/lib/chat-files";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { publishTokenQuotaUpdate } from "@/lib/token-quota-redis";

export const runtime = "nodejs";
export const maxDuration = 60;
const MODEL = "x-ai/grok-imagine-video-1.5-lite";
const CREDITS_PER_USD = 250_000;
const DURATION = 3;
const RESOLUTION = "480p";
const errorResponse = (error: string, status: number) => NextResponse.json({ error }, { status });
type CreditRow = { request_id?: string; llm_token_quota: number | string; llm_token_used: number | string; charged_credits?: number | string };
type Job = { id: string; user_id: string; status: string; provider_job_id: string | null; credit_request_id: string; output_file_id: string | null; created_at: string };

async function account() {
  if (!hasSupabaseEnv() || !hasSupabaseServiceRoleEnv() || !process.env.OPENROUTER_API_KEY?.trim()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);
  if (error || !userId) return null;
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  return { userId, email, apiKey: process.env.OPENROUTER_API_KEY.trim(), admin: createAdminClient() };
}
function sameOrigin(request: Request) {
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host");
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return Boolean(host && new URL(origin).host === host); } catch { return false; }
}
async function readBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !request.body) throw new Error("invalid request");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 64_000) { await reader.cancel(); throw new Error("request too large"); } chunks.push(part.value); }
  return JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size).toString("utf8")) as { prompt?: unknown; jobId?: unknown };
}
async function price(apiKey: string) {
  const response = await fetch("https://openrouter.ai/api/v1/videos/models", { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  const result = await response.json() as { data?: Array<{ id?: string; supported_durations?: number[]; supported_resolutions?: string[]; supported_aspect_ratios?: string[]; pricing_skus?: Record<string, string> }> };
  const model = result.data?.find(item => item.id === MODEL);
  const cents = Number(model?.pricing_skus?.cents_per_video_output_second_480p);
  if (!response.ok || !model?.supported_durations?.includes(DURATION) || !model.supported_resolutions?.includes(RESOLUTION) || !model.supported_aspect_ratios?.includes("16:9") || !Number.isFinite(cents) || cents <= 0) throw new Error("video pricing unavailable");
  return Math.ceil((cents / 100) * DURATION * CREDITS_PER_USD);
}
async function notify(context: NonNullable<Awaited<ReturnType<typeof account>>>, row: CreditRow, reason: "chat_credit_reservation" | "chat_credit_settlement", requestId: string) {
  const { data: profile } = await context.admin.from("profiles").select("email,openclaw_instance").eq("id", context.userId).maybeSingle();
  if (profile) await publishTokenQuotaUpdate({ userId: context.userId, actorUserId: context.userId, email: context.email || profile.email, openclawInstance: profile.openclaw_instance, llmTokenQuota: Number(row.llm_token_quota), llmTokenUsed: Number(row.llm_token_used), reason, metadata: { chatRequestId: requestId } });
}

export async function GET() {
  const context = await account(); if (!context) return errorResponse("Please log in to use video generation.", 401);
  const { data, error } = await context.admin.from("chat_video_jobs").select("id,status,output_file_id,created_at").eq("user_id", context.userId).order("created_at", { ascending: false }).limit(20);
  if (error) return errorResponse("Video jobs are unavailable.", 503);
  let credits: number | null = null; try { credits = await price(context.apiKey); } catch { /* preserve access to prior jobs */ }
  const jobs = (data ?? []).map(job => job.status === "submitting" && Date.parse(job.created_at) < Date.now() - 120_000 ? { ...job, status: "uncertain" } : job);
  return NextResponse.json({ credits, estimatedUsd: credits === null ? null : credits / CREDITS_PER_USD, jobs }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const context = await account(); if (!context) return errorResponse("Please log in to use video generation.", 401);
  if (!sameOrigin(request)) return errorResponse("Invalid request origin.", 403);
  let body; try { body = await readBody(request); } catch { return errorResponse("Invalid request.", 400); }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > 10_000) return errorResponse("Enter a video prompt of up to 10,000 characters.", 400);
  let reserve: number; try { reserve = await price(context.apiKey); } catch { return errorResponse("Video pricing or this three-second model is temporarily unavailable.", 503); }
  const isAdmin = await isAdminUser(context.email, context.userId);
  const { data: reserved, error } = await context.admin.rpc("reserve_chat_credits_itemized", { p_user_id: context.userId, p_model_id: MODEL, p_credits: reserve, p_is_admin: isAdmin, p_kind: "video_generation", p_pdf_pages: null }).single();
  const row = reserved as CreditRow | null;
  if (error || !row?.request_id) return errorResponse(error?.message?.includes("insufficient_ai_credits") ? `This video needs a reservation of ${reserve.toLocaleString("en")} AI credits.` : "Credit accounting is unavailable.", error?.message?.includes("insufficient_ai_credits") ? 402 : 503);
  const requestId = row.request_id;
  if (!isAdmin) await notify(context, row, "chat_credit_reservation", requestId);
  const settle = async (status: "failed" | "uncertain") => {
    const { data } = await context.admin.rpc("settle_chat_credits_itemized", { p_user_id: context.userId, p_request_id: requestId, p_status: status, p_actual_credits: 0, p_cost_usd: null, p_provider_request_id: null, p_prompt_tokens: null, p_completion_tokens: null }).single();
    if (data && !isAdmin) await notify(context, data as CreditRow, "chat_credit_settlement", requestId);
    return Boolean(data);
  };
  const { data: job, error: jobError } = await context.admin.from("chat_video_jobs").insert({ user_id: context.userId, credit_request_id: requestId }).select("id").single();
  if (jobError || !job) { await settle("failed"); return errorResponse("Could not create a video job.", 503); }
  try {
    const response = await fetch("https://openrouter.ai/api/v1/videos", { method: "POST", headers: { Authorization: `Bearer ${context.apiKey}`, "Content-Type": "application/json", "X-Title": "AI CUBER" }, body: JSON.stringify({ model: MODEL, prompt, duration: DURATION, resolution: RESOLUTION, aspect_ratio: "16:9" }), signal: AbortSignal.timeout(50_000) });
    if (!response.ok) {
      const knownFailure = response.status >= 400 && response.status < 500 && response.status !== 408;
      const done = await settle(knownFailure ? "failed" : "uncertain");
      await context.admin.from("chat_video_jobs").update({ status: done && knownFailure ? "failed" : "uncertain", updated_at: new Date().toISOString() }).eq("id", job.id).eq("user_id", context.userId);
      return errorResponse(done && knownFailure ? "The video request was rejected." : "The video request could not be confirmed. Check AI Credits Usage before retrying.", 502);
    }
    const result = await response.json() as { id?: unknown };
    if (typeof result.id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(result.id)) throw new Error("invalid job id");
    const saved = await context.admin.from("chat_video_jobs").update({ status: "pending", provider_job_id: result.id, updated_at: new Date().toISOString() }).eq("id", job.id).eq("user_id", context.userId).select("id").single();
    if (saved.error || !saved.data) throw new Error("failed to save provider job id");
    return NextResponse.json({ message: "Your three-second video is being generated. Its progress will appear below; the finished video will be saved to My Files.", jobId: job.id });
  } catch {
    await settle("uncertain").catch(() => undefined);
    await context.admin.from("chat_video_jobs").update({ status: "uncertain", updated_at: new Date().toISOString() }).eq("id", job.id).eq("user_id", context.userId);
    return errorResponse("The video request could not be confirmed. Check AI Credits Usage before retrying.", 502);
  }
}

export async function PATCH(request: Request) {
  const context = await account(); if (!context) return errorResponse("Please log in to use video generation.", 401);
  if (!sameOrigin(request)) return errorResponse("Invalid request origin.", 403);
  let body; try { body = await readBody(request); } catch { return errorResponse("Invalid request.", 400); }
  if (typeof body.jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.jobId)) return errorResponse("Invalid job.", 400);
  const stale = new Date(Date.now() - 120_000).toISOString();
  const { data: claimed, error: claimError } = await context.admin.from("chat_video_jobs").update({ processing_at: new Date().toISOString() }).eq("id", body.jobId).eq("user_id", context.userId).eq("status", "pending").or(`processing_at.is.null,processing_at.lt.${stale}`).select("*").maybeSingle();
  if (claimError) return errorResponse("Video status is unavailable.", 503);
  if (!claimed) return NextResponse.json({ status: "pending" });
  const job = claimed as Job;
  try {
    if (!job.provider_job_id || !/^[a-zA-Z0-9_-]{1,200}$/.test(job.provider_job_id)) throw new Error("invalid job");
    const response = await fetch(`https://openrouter.ai/api/v1/videos/${encodeURIComponent(job.provider_job_id)}`, { headers: { Authorization: `Bearer ${context.apiKey}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("provider status unavailable");
    const video = await response.json() as { status?: string; generation_id?: unknown; usage?: { cost?: unknown } };
    if (video.status === "pending" || video.status === "in_progress") return NextResponse.json({ status: "pending" });
    if (!["completed", "failed", "cancelled", "expired"].includes(video.status || "")) throw new Error("unknown status");
    const cost = typeof video.usage?.cost === "number" && Number.isFinite(video.usage.cost) && video.usage.cost >= 0 ? video.usage.cost : null;
    const { data: ledger } = await context.admin.from("chat_credit_requests").select("status,quota_exempt").eq("id", job.credit_request_id).eq("user_id", context.userId).maybeSingle();
    if (!ledger) throw new Error("credit request unavailable");
    if (ledger.status !== "completed" && ledger.status !== "failed") {
      const status = cost === null ? "uncertain" : "completed";
      if (!(ledger.status === "uncertain" && status === "uncertain")) {
        const { data: settled, error } = await context.admin.rpc("settle_chat_credits_itemized", { p_user_id: context.userId, p_request_id: job.credit_request_id, p_status: status, p_actual_credits: cost === null ? 0 : Math.ceil(cost * CREDITS_PER_USD), p_cost_usd: cost, p_provider_request_id: typeof video.generation_id === "string" ? video.generation_id : job.provider_job_id, p_prompt_tokens: null, p_completion_tokens: null }).single();
        if (error || !settled) throw new Error("settlement unavailable");
        if (!ledger.quota_exempt) await notify(context, settled as CreditRow, "chat_credit_settlement", job.credit_request_id);
      }
    }
    if (video.status !== "completed") {
      await context.admin.from("chat_video_jobs").update({ status: cost === null ? "uncertain" : "failed", updated_at: new Date().toISOString() }).eq("id", job.id).eq("user_id", context.userId);
      return NextResponse.json({ status: cost === null ? "uncertain" : "failed" });
    }
    let fileId = job.output_file_id;
    if (!fileId) {
      const content = await fetch(`https://openrouter.ai/api/v1/videos/${encodeURIComponent(job.provider_job_id)}/content?index=0`, { headers: { Authorization: `Bearer ${context.apiKey}` }, signal: AbortSignal.timeout(30_000), redirect: "error" });
      if (!content.ok || !content.body) throw new Error("video download unavailable");
      const reader = content.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 20 * 1024 * 1024) { await reader.cancel(); throw new Error("video too large"); } chunks.push(part.value); }
      const file = await saveChatGeneratedVideo(context.admin, context.userId, Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size));
      fileId = file.id;
    }
    const { error: saveError } = await context.admin.from("chat_video_jobs").update({ status: cost === null ? "pending" : "completed", output_file_id: fileId, updated_at: new Date().toISOString() }).eq("id", job.id).eq("user_id", context.userId);
    if (saveError) throw new Error("job update failed");
    return NextResponse.json({ status: cost === null ? "pending" : "completed", fileId, usagePending: cost === null });
  } catch { return errorResponse("Video status or storage is temporarily unavailable. The existing job will be checked again.", 503); }
  finally { await context.admin.from("chat_video_jobs").update({ processing_at: null }).eq("id", job.id).eq("user_id", context.userId); }
}
