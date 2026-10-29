import PizZip from "pizzip";
import { NextResponse } from "next/server";
import { loadChatFile } from "@/lib/chat-files";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;
const activeUsers = new Set<string>();
export async function POST(request: Request) {
  const reject = (error: string, status: number) => NextResponse.json({ error }, { status });
  if (!hasSupabaseEnv() || !hasSupabaseServiceRoleEnv()) return reject("File storage is not configured.", 503);
  const client = await createClient(), { data, error } = await client.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);
  if (error || !userId) return reject("Please log in to download files.", 401);
  const origin = request.headers.get("origin"), host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host");
  if (origin && (!host || (() => { try { return new URL(origin).host !== host; } catch { return true; } })())) return reject("Invalid request origin.", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return reject("Invalid request.", 400);
  let ids: unknown;
  try {
    if (!request.body) throw new Error();
    const reader = request.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 8000) { await reader.cancel(); return reject("Request is too large.", 413); } chunks.push(part.value); }
    ids = JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size).toString("utf8")).fileIds;
  } catch { return reject("Invalid request.", 400); }
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) return reject("Choose up to 100 different generated files.", 400);
  if (activeUsers.has(userId) || activeUsers.size >= 4) return reject("ZIP downloads are busy. Please try again shortly.", 429);
  activeUsers.add(userId);
  try {
    const admin = createAdminClient(), zip = new PizZip(), names = new Set<string>(); let total = 0;
    for (const id of ids) {
      const saved = await loadChatFile(admin, userId, id);
      if (!saved || saved.metadata.origin !== "output") return reject("A generated file was not found.", 404);
      total += saved.file.data.length;
      if (total > 60 * 1024 * 1024) return reject("The selected files exceed the 60 MB download limit.", 413);
      let name = saved.file.name.replace(/[\\/\x00-\x1f\x7f]/g, "_").replace(/^\.+/, "").slice(0, 150) || "document";
      const original = name; let number = 2;
      while (names.has(name.toLowerCase())) { name = `${number++}-${original}`; }
      names.add(name.toLowerCase()); zip.file(name, saved.file.data);
    }
    const bytes = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="generated-documents.zip"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return reject("The files could not be downloaded. Please try again.", 503); }
  finally { activeUsers.delete(userId); }
}
