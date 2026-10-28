import { NextResponse } from "next/server";
import { documentText, presentationText, spreadsheetPreview } from "@/lib/chat-attachments";
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
      return new Response(new Uint8Array(file.data), { headers: { ...headers, "Content-Type": file.mime, "Content-Disposition": "inline", "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin" } });
    }
    if (isImage || isPdf || isVideo) return NextResponse.json({ kind: isPdf ? "pdf" : isVideo ? "video" : "image", name: file.name }, { headers });
    if (file.type === "spreadsheet") return NextResponse.json({ kind: "spreadsheet", name: file.name, ...await spreadsheetPreview(file) }, { headers });
    const isDocx = file.type === "document" || (file.type === "output" && file.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const isPptx = file.type === "presentation" || (file.type === "output" && file.mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    const text = isDocx ? await documentText({ ...file, type: "document" }) : isPptx ? await presentationText({ ...file, type: "presentation" }) : file.data.toString("utf8");
    return NextResponse.json({ kind: "text", name: file.name, text: text.slice(0, 200_000), truncated: text.length > 200_000 }, { headers });
  } catch (error) {
    console.error("[chat:preview] Could not preview file", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "This file could not be previewed. You can still download it." }, { status: 422, headers });
  }
}
