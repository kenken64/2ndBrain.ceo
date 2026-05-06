import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

function titleFromPrompt(prompt: string) {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  if (!cleaned) {
    return "Untitled project";
  }

  return cleaned.length > 64 ? `${cleaned.slice(0, 61)}...` : cleaned;
}

async function requireUser() {
  if (!hasSupabaseEnv()) {
    return {
      supabase: null,
      response: NextResponse.json({ error: "Supabase is not configured" }, { status: 503 })
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    return {
      supabase: null,
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 })
    };
  }

  return {
    supabase,
    userId: data.claims.sub,
    response: null
  };
}

export async function GET() {
  const auth = await requireUser();

  if (auth.response) {
    return auth.response;
  }

  const { data, error } = await auth.supabase
    .from("projects")
    .select("id,title,prompt,status,created_at")
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ projects: data });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  const contentType = request.headers.get("content-type") ?? "";
  const isFormPost = contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");

  if (auth.response) {
    if (isFormPost) {
      return NextResponse.redirect(new URL("/login?next=/dashboard", request.url), {
        status: 303
      });
    }

    return auth.response;
  }

  const payload = isFormPost ? await request.formData() : await request.json();
  const prompt =
    payload instanceof FormData
      ? String(payload.get("prompt") ?? "")
      : String(payload.prompt ?? "");

  if (!prompt.trim()) {
    if (isFormPost) {
      return NextResponse.redirect(new URL("/dashboard?error=empty_prompt", request.url), {
        status: 303
      });
    }

    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("projects")
    .insert({
      user_id: auth.userId,
      title: titleFromPrompt(prompt),
      prompt,
      status: "draft"
    })
    .select("id,title,prompt,status,created_at")
    .single();

  if (error) {
    if (isFormPost) {
      return NextResponse.redirect(new URL("/dashboard?error=project_insert", request.url), {
        status: 303
      });
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (isFormPost) {
    return NextResponse.redirect(new URL("/dashboard?created=1", request.url), {
      status: 303
    });
  }

  return NextResponse.json({ project: data }, { status: 201 });
}
