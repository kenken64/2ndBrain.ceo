import { NextResponse } from "next/server";
import { loadChatFile } from "@/lib/chat-files";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createAdminClient, hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseEnv() || !hasSupabaseServiceRoleEnv()) return NextResponse.json({ error: "File storage is not configured." }, { status: 503 });
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);
  if (error || !userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const saved = await loadChatFile(createAdminClient(), userId, (await params).id);
    if (!saved) return NextResponse.json({ error: "File not found." }, { status: 404 });
    const encoded = encodeURIComponent(saved.file.name).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(new Uint8Array(saved.file.data), { headers: { "Content-Type": saved.file.mime, "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encoded}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return NextResponse.json({ error: "Saved file is unavailable." }, { status: 503 }); }
}
