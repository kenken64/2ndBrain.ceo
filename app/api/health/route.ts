import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({
      ok: true,
      supabase: "not_configured",
      authenticated: false
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  return NextResponse.json({
    ok: true,
    supabase: "configured",
    authenticated: Boolean(data?.claims && !error),
    subject: data?.claims?.sub ?? null
  });
}
