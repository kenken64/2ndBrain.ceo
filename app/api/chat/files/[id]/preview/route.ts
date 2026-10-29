import { NextResponse } from "next/server";
import { checkOfficeArchive, presentationText, spreadsheetPreview } from "@/lib/chat-attachments";
import { loadChatFile } from "@/lib/chat-files";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseEnv() || !hasSupabaseServiceRoleEnv()) return NextResponse.json({ error: "File storage is not configured." }, { status: 503 });
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);
  if (error || !userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const saved = await loadChatFile(createAdminClient(), userId, (await params).id);
    if (!saved) return NextResponse.json({ error: "File not found." }, { status: 404 });
    const { file } = saved;
    const isPdf = file.type === "pdf" || (file.type === "output" && file.mime === "application/pdf");
    const isImage = file.type === "image" || (file.type === "output" && ["image/png", "image/jpeg", "image/webp"].includes(file.mime));
    const isVideo = file.type === "output" && file.mime === "video/mp4";
    if (new URL(request.url).searchParams.get("inline") === "1") {
      if (!isImage && !isPdf && !isVideo) return NextResponse.json({ error: "This file cannot be displayed inline." }, { status: 400, headers });
      const inlineHeaders = { ...headers, "Content-Type": file.mime, "Content-Disposition": "inline", "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin" };
      if (isVideo) {
        const size = file.data.length;
        const range = request.headers.get("range");
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
          const first = match?.[1] ? Number(match[1]) : null;
          const last = match?.[2] ? Number(match[2]) : null;
          if (!match || (first === null && last === null) || (first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last)) || (first === null && last === 0) || (first !== null && (first >= size || (last !== null && last < first)))) {
            return new Response(null, { status: 416, headers: { ...inlineHeaders, "Accept-Ranges": "bytes", "Content-Range": `bytes */${size}` } });
          }
          const start = first === null ? Math.max(0, size - last!) : first;
          const end = first === null || last === null ? size - 1 : Math.min(size - 1, last);
          return new Response(new Uint8Array(file.data.subarray(start, end + 1)), { status: 206, headers: { ...inlineHeaders, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
        }
        return new Response(new Uint8Array(file.data), { headers: { ...inlineHeaders, "Accept-Ranges": "bytes", "Content-Length": String(size) } });
      }
      return new Response(new Uint8Array(file.data), { headers: inlineHeaders });
    }
    if (isImage || isPdf || isVideo) return NextResponse.json({ kind: isPdf ? "pdf" : isVideo ? "video" : "image", name: file.name }, { headers });
    if (file.type === "spreadsheet") return NextResponse.json({ kind: "spreadsheet", name: file.name, ...await spreadsheetPreview(file) }, { headers });
    const isDocx = file.type === "document" || (file.type === "output" && file.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const isPptx = file.type === "presentation" || (file.type === "output" && file.mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    if (isDocx) {
      await checkOfficeArchive(file.data, "DOCX");
      return NextResponse.json({ kind: "document", name: file.name }, { headers });
    }
    if (isPptx) {
      const text = await presentationText({ ...file, type: "presentation" });
      return NextResponse.json({ kind: "presentation", name: file.name, text: text.slice(0, 200_000), truncated: text.length > 200_000 }, { headers });
    }
    const text = file.data.toString("utf8");
    return NextResponse.json({ kind: "text", name: file.name, text: text.slice(0, 200_000), truncated: text.length > 200_000 }, { headers });
  } catch (error) {
    console.error("[chat:preview] Could not preview file", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "This file could not be previewed. You can still download it." }, { status: 422, headers });
  }
}
