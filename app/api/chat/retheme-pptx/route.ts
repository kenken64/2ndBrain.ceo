import { NextResponse } from "next/server";
import { validateChatFile } from "@/lib/chat-attachments";
import { loadChatFile, saveChatGeneratedPptx } from "@/lib/chat-files";
import { restyleChatPresentation } from "@/lib/chat-pptx-retheme";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;
const errorResponse = (error: string, status: number) => NextResponse.json({ error }, { status });
// Bound memory-intensive PowerPoint processing within each server process.
const activeUsers = new Set<string>();

export async function POST(request: Request) {
  if (!hasSupabaseEnv() || !hasSupabaseServiceRoleEnv()) return errorResponse("File storage is not configured.", 503);
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);
  if (error || !userId) return errorResponse("Please log in to use chat.", 401);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host");
  const origin = request.headers.get("origin");
  if (origin && (!host || (() => { try { return new URL(origin).host !== host; } catch { return true; } })())) return errorResponse("Invalid request origin.", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return errorResponse("Invalid request.", 400);
  let body: { sourceId?: unknown; templateId?: unknown };
  try {
    if (!request.body) throw new Error("empty");
    const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 4096) { await reader.cancel(); return errorResponse("Request is too large.", 413); } chunks.push(part.value); }
    body = JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size).toString("utf8"));
  } catch { return errorResponse("Invalid request.", 400); }
  if (typeof body?.sourceId !== "string" || typeof body?.templateId !== "string" || body.sourceId === body.templateId) return errorResponse("Choose a source PowerPoint and a different template PowerPoint.", 400);
  if (activeUsers.has(userId) || activeUsers.size >= 4) return errorResponse("PowerPoint transfers are busy. Please try again shortly.", 429);
  activeUsers.add(userId);
  try {
    const admin = createAdminClient();
    let source, template;
    try { [source, template] = await Promise.all([loadChatFile(admin, userId, body.sourceId), loadChatFile(admin, userId, body.templateId)]); }
    catch { return errorResponse("Could not load the saved files. Please try again.", 503); }
    if (!source || !template) return errorResponse("A saved file was not found.", 404);
    const sourceFile = validateChatFile(source.file.name, source.file.data), templateFile = validateChatFile(template.file.name, template.file.data);
    if (sourceFile.type !== "presentation" || templateFile.type !== "presentation") return errorResponse("Choose two PowerPoint (.pptx) files.", 400);
    const result = await restyleChatPresentation(sourceFile.data, templateFile.data);
    const name = `${sourceFile.name.replace(/\.pptx$/i, "").slice(0, 110)}-restyled.pptx`;
    let savedOutput;
    try { savedOutput = await saveChatGeneratedPptx(admin, userId, source.metadata.id, name, result.data); }
    catch { return errorResponse("The presentation could not be saved. Please try again.", 503); }
    const note = result.containsNotesOrAnimations ? " Speaker notes, transitions, or animations were detected and are not transferred." : "";
    return NextResponse.json({ message: `Applied the template to ${result.slideCount} slide${result.slideCount === 1 ? "" : "s"}. The editable presentation is saved in My files. Review every slide for overlap and styling.${note} This transfer did not use AI credits.`, savedOutput });
  } catch (reason) {
    console.error("[chat:pptx-retheme] Transfer failed", reason instanceof Error ? reason.message : "unknown");
    return errorResponse(reason instanceof Error && /^(Each PowerPoint|PowerPoint files|A required PowerPoint|The PowerPoint|The two presentations|Both presentations|Use presentations|Grouped objects|This presentation|A slide|Some text|Some charts|Some source images|A slide image|The resulting PowerPoint|The transferred slide)/.test(reason.message) ? reason.message : "Could not transfer this PowerPoint. Please simplify the presentations or try another template.", 422);
  } finally {
    activeUsers.delete(userId);
  }
}
