import { NextResponse } from "next/server";
import { spreadsheetContext } from "@/lib/chat-attachments";
import { loadChatFile, saveChatGeneratedDocx, saveChatGeneratedPdf, saveChatGeneratedPptx } from "@/lib/chat-files";
import { prepareDocxBatch, renderDocxRow } from "@/lib/chat-docx-batch";
import { preparePdfBatch, renderPdfRow, validateBatchMapping } from "@/lib/chat-pdf-batch";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;
const activeUsers = new Set<string>();
const errorResponse = (error: string, status: number) => NextResponse.json({ error }, { status });
const normal = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export async function POST(request: Request) {
  if (!hasSupabaseEnv() || !hasSupabaseServiceRoleEnv()) return errorResponse("File storage is not configured.", 503);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);
  if (error || !userId) return errorResponse("Please log in to use chat.", 401);
  const origin = request.headers.get("origin"), host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host");
  if (origin && (!host || (() => { try { return new URL(origin).host !== host; } catch { return true; } })())) return errorResponse("Invalid request origin.", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return errorResponse("Invalid request.", 400);
  let body: { fileIds?: unknown; mappings?: unknown; action?: unknown };
  try {
    if (!request.body) throw new Error("empty");
    const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 64000) { await reader.cancel(); return errorResponse("Request is too large.", 413); } chunks.push(part.value); }
    body = JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size).toString("utf8"));
  } catch { return errorResponse("Invalid request.", 400); }
  const ids = body?.fileIds;
  if (!Array.isArray(ids) || ids.length !== 2 || ids.some(id => typeof id !== "string") || ids[0] === ids[1] || !["review", "run"].includes(String(body.action))) return errorResponse("Choose one spreadsheet and one document template.", 400);
  if (activeUsers.has(userId) || activeUsers.size >= 4) return errorResponse("Batch processing is busy. Please try again shortly.", 429);
  activeUsers.add(userId);
  let streaming = false;
  try {
    const admin = createAdminClient();
    const stored = await Promise.all(ids.map(id => loadChatFile(admin, userId, id)));
    if (stored.some(item => !item)) return errorResponse("A saved file was not found.", 404);
    const template = stored.find(item => item?.metadata.origin === "upload" && ["pdf", "document", "presentation"].includes(item.file.type));
    const sheet = stored.find(item => item?.metadata.origin === "upload" && item.file.type === "spreadsheet");
    if (!template || !sheet || sheet.file.type !== "spreadsheet" || (template.file.type !== "pdf" && template.file.type !== "document" && template.file.type !== "presentation")) return errorResponse("Choose an uploaded spreadsheet and a PDF, DOCX or PPTX template.", 400);
    const type = template.file.type === "pdf" ? "pdf" : template.file.type === "document" ? "docx" : "pptx";
    const context = await spreadsheetContext(sheet.file);
    const batch = type === "pdf" ? await preparePdfBatch(template.file.data, context) : await prepareDocxBatch(template.file, context);
    if (body.action === "review") {
      const mappings = batch.fields.map(field => {
        const matches = batch.headers.filter(header => normal(header) === normal(field.name));
        return { field: field.name, column: matches.length === 1 ? matches[0] : null };
      });
      return NextResponse.json({ fields: batch.fields, columns: batch.headers, rowCount: batch.rows.length, mappings, template: template.file.name, spreadsheet: sheet.file.name, templateType: type }, { headers: { "Cache-Control": "no-store" } });
    }
    const mapping = validateBatchMapping({ mappings: body.mappings }, batch);
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder(); let succeeded = 0, failed = 0, totalBytes = 0;
        const send = (value: unknown) => { if (!cancelled) controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)); };
        try {
          send({ type: "start", total: batch.rows.length });
          for (const row of batch.rows) {
            if (cancelled) break;
            try {
              for (const field of batch.fields.filter(item => item.required)) {
                const column = mapping.find(item => item.field === field.name)?.column;
                const value = column ? row.values[batch.headers.indexOf(column)] : null;
                if (value == null || !String(value).trim()) throw new Error(`Row ${row.number}: required column “${column ?? field.name}” is empty.`);
              }
              const bytes = type === "pdf" ? await renderPdfRow(template.file.data, batch, mapping, row) : renderDocxRow(template.file.data, batch, mapping, row);
              if (bytes.length > 20 * 1024 * 1024 || totalBytes + bytes.length > 60 * 1024 * 1024) throw new Error("The batch exceeds its 60 MB output limit.");
              const base = template.file.name.replace(/\.(pdf|docx|pptx)$/i, "").slice(0, 100) || "document";
              const name = `${base}-row-${row.number}.${type}`;
              let file;
              try { file = type === "pdf" ? await saveChatGeneratedPdf(admin, userId, template.metadata.id, name, bytes) : type === "docx" ? await saveChatGeneratedDocx(admin, userId, template.metadata.id, name, bytes) : await saveChatGeneratedPptx(admin, userId, template.metadata.id, name, bytes); }
              catch { throw new Error(`Row ${row.number}: the generated file could not be saved.`); }
              totalBytes += bytes.length; succeeded++; send({ type: "row", row: row.number, status: "succeeded", file: { id: file.id, name: file.name } });
            } catch (reason) {
              failed++; const message = reason instanceof Error ? reason.message.slice(0, 500) : `Row ${row.number} could not be generated.`;
              send({ type: "row", row: row.number, status: "failed", error: message });
            }
          }
          send({ type: "done", total: batch.rows.length, succeeded, failed });
        } catch { send({ type: "error", message: "The batch stopped unexpectedly. Check My files for saved results." }); }
        finally { activeUsers.delete(userId); if (!cancelled) controller.close(); }
      },
      cancel() { cancelled = true; }
    });
    streaming = true;
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
  } catch (reason) {
    return errorResponse(reason instanceof Error ? reason.message : "Could not read the files.", 400);
  } finally { if (!streaming) activeUsers.delete(userId); }
}
