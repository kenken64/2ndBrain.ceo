import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { getCreditOptions } from "@/lib/credit-pricing-server";
import { getTextTokenPricing } from "@/lib/credit-token-estimates";
import { getUserIdFromClaims } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!hasSupabaseEnv()) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !getUserIdFromClaims(data?.claims)) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const [options, textEstimate] = await Promise.all([getCreditOptions(), getTextTokenPricing().catch(() => null)]);
    return NextResponse.json({ ...options, textEstimate }, { headers: { "Cache-Control": "private, no-store" } });
  }
  catch { return NextResponse.json({ error: "Exchange rates are temporarily unavailable. Please try again." }, { status: 503 }); }
}
