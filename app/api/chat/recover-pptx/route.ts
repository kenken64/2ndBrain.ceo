import { NextResponse } from "next/server";
import { checkOfficeArchive, validateChatFile } from "@/lib/chat-attachments";
import { saveChatGeneratedPptx } from "@/lib/chat-files";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;
const LIMIT = 5 * 1024 * 1024;
const activeUsers = new Set<string>();
const errorResponse = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(request: Request) {
  if (!hasSupabaseEnv() || !hasSupabaseServiceRoleEnv()) return errorResponse("File storage is not configured.", 503);
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);
  if (error || !userId) return errorResponse("Please log in to save the presentation.", 401);
  const origin = request.headers.get("origin"), host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host");
  if (origin && (!host || (() => { try { return new URL(origin).host !== host; } catch { return true; } })())) return errorResponse("Invalid request origin.", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/octet-stream") return errorResponse("Invalid request.", 400);
  if (Number(request.headers.get("content-length") ?? 0) > LIMIT || !request.body) return errorResponse("Presentation is too large to save this way.", 413);
  if (activeUsers.has(userId) || activeUsers.size >= 4) return errorResponse("Saving is busy. Please try again shortly.", 429);
  activeUsers.add(userId);
  try {
    const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > LIMIT) { await reader.cancel(); return errorResponse("Presentation is too large to save this way.", 413); } chunks.push(part.value); }
    const declared = request.headers.get("content-length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) !== size)) return errorResponse("The presentation upload was incomplete.", 400);
    const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size);
    try { validateChatFile("presentation.pptx", bytes); await checkOfficeArchive(bytes, "PPTX"); }
    catch { return errorResponse("The presentation is invalid or too large to process.", 400); }
    const file = await saveChatGeneratedPptx(createAdminClient(), userId, null, "presentation.pptx", bytes);
    return NextResponse.json({ file }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[chat:pptx] Recovery save failed", { errorType: error instanceof Error ? error.name : "unknown" });
    return errorResponse("The presentation could not be saved. Download it or try saving again.", 503);
  } finally { activeUsers.delete(userId); }
}
