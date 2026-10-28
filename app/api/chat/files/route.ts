import { NextResponse } from "next/server";
import { validateChatFile } from "@/lib/chat-attachments";
import { saveChatFile } from "@/lib/chat-files";
import { CHAT_FILE_MAX_BYTES } from "@/lib/chat-files-shared";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function authenticate() {
  if (!hasSupabaseEnv()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);
  return error || !userId ? null : { supabase, userId };
}
export async function GET(request: Request) {
  const auth = await authenticate();
  if (!auth) return NextResponse.json({ error: "Please log in to view saved files." }, { status: 401 });
  const pageValue = new URL(request.url).searchParams.get("page") ?? "1";
  if (!/^[1-9]\d{0,3}$/.test(pageValue)) return NextResponse.json({ error: "Invalid page." }, { status: 400 });
  const page = Number(pageValue), size = 30;
  const { data, error } = await auth.supabase.from("chat_files").select("id,file_name,mime_type,size_bytes,created_at,file_origin").eq("user_id", auth.userId).order("created_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * size, page * size);
  if (error) return NextResponse.json({ error: "Saved files are unavailable." }, { status: 503 });
  return NextResponse.json({ files: (data ?? []).slice(0, size).map(row => ({ id: row.id, name: row.file_name, mime: row.mime_type, size: row.size_bytes, createdAt: row.created_at, origin: row.file_origin })), page, hasMore: (data?.length ?? 0) > size }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const auth = await authenticate();
  if (!auth) return NextResponse.json({ error: "Please log in to save files." }, { status: 401 });
  if (!hasSupabaseServiceRoleEnv()) return NextResponse.json({ error: "File storage is not configured." }, { status: 503 });
  const origin = request.headers.get("origin"), host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host");
  if (origin && (!host || (() => { try { return new URL(origin).host !== host; } catch { return true; } })())) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/octet-stream") return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (!request.body || Number(request.headers.get("content-length") ?? 0) > CHAT_FILE_MAX_BYTES) return NextResponse.json({ error: "Choose a file no larger than 20 MB." }, { status: 413 });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > CHAT_FILE_MAX_BYTES) { await reader.cancel(); return NextResponse.json({ error: "Choose a file no larger than 20 MB." }, { status: 413 }); }
      chunks.push(part.value);
    }
    const declaredSize = request.headers.get("content-length");
    if (declaredSize && (!/^\d+$/.test(declaredSize) || Number(declaredSize) !== length)) return NextResponse.json({ error: "Upload was incomplete. Please try again." }, { status: 400 });
    const file = validateChatFile(name, Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), length));
    const saved = await saveChatFile(createAdminClient(), auth.userId, file);
    return NextResponse.json({ file: saved }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "File could not be saved.";
    return NextResponse.json({ error: message }, { status: message.startsWith("Choose ") ? 400 : 503 });
  }
}
