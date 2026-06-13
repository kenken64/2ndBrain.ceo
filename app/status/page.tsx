import type { Metadata } from "next";
import { Atmosphere } from "@/components/atmosphere";
import { Footer } from "@/components/footer";
import { MarketingNav } from "@/components/marketing-nav";
import { getSiteUrl, getSupabaseEnvStatus, hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "System Status"
};

type CheckTone = "operational" | "attention" | "degraded";

type StatusCheck = {
  detail: string;
  label: string;
  summary: string;
  tone: CheckTone;
};

function sourceCopy(source: string | null) {
  return source ? `Source: ${source}` : "Source: not configured";
}

function statusLabel(tone: CheckTone) {
  if (tone === "degraded") {
    return "Degraded";
  }

  if (tone === "attention") {
    return "Needs attention";
  }

  return "Operational";
}

function overallTone(checks: StatusCheck[]): CheckTone {
  if (checks.some((check) => check.tone === "degraded")) {
    return "degraded";
  }

  if (checks.some((check) => check.tone === "attention")) {
    return "attention";
  }

  return "operational";
}

export default async function StatusPage() {
  const generatedAt = new Date();
  const env = getSupabaseEnvStatus();
  const supabaseConfigured = hasSupabaseEnv();
  const siteUrl = getSiteUrl();

  let sessionCheck: StatusCheck = {
    label: "Current session",
    tone: supabaseConfigured ? "operational" : "attention",
    summary: supabaseConfigured
      ? "Public access is available. No signed-in session is required for this page."
      : "Auth cannot be checked until Supabase is configured.",
    detail: supabaseConfigured
      ? "Session state: guest or signed-out visitor"
      : "Supabase URL or publishable key is missing."
  };

  if (supabaseConfigured) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.getClaims();

      sessionCheck = {
        label: "Current session",
        tone: error ? "attention" : "operational",
        summary: data?.claims
          ? "A signed-in session is present."
          : "Public access is available. No signed-in session is required for this page.",
        detail: error
          ? `Session check returned: ${error.message}`
          : data?.claims
            ? "Session state: authenticated visitor"
            : "Session state: guest or signed-out visitor"
      };
    } catch (error) {
      sessionCheck = {
        label: "Current session",
        tone: "attention",
        summary: "The status page loaded, but the session check could not complete.",
        detail: error instanceof Error ? error.message : "Session check failed."
      };
    }
  }

  const checks: StatusCheck[] = [
    {
      label: "Web application",
      tone: "operational",
      summary: "The Next.js app rendered this status page.",
      detail: `Generated at ${generatedAt.toISOString()}`
    },
    {
      label: "Health API",
      tone: "operational",
      summary: "The machine-readable health endpoint remains available.",
      detail: "GET /api/health"
    },
    {
      label: "Supabase configuration",
      tone: supabaseConfigured ? "operational" : "degraded",
      summary: supabaseConfigured
        ? "Supabase URL and publishable key are configured."
        : "Supabase configuration is incomplete.",
      detail: `${sourceCopy(env.urlSource)} / ${sourceCopy(env.keySource)}`
    },
    {
      label: "Site URL",
      tone: env.siteUrlConfigured ? "operational" : "attention",
      summary: env.siteUrlConfigured
        ? "Canonical site URL is configured."
        : "Using the local fallback site URL.",
      detail: env.siteUrlConfigured
        ? `${siteUrl} / ${sourceCopy(env.siteUrlSource)}`
        : `${siteUrl} / configure NEXT_PUBLIC_SITE_URL or RAILWAY_PUBLIC_DOMAIN`
    },
    sessionCheck
  ];
  const tone = overallTone(checks);

  return (
    <>
      <Atmosphere />
      <div className="page-shell">
        <MarketingNav anchorPrefix="/" supabaseConfigured={supabaseConfigured} />
        <main className="status-page">
          <section className="container status-hero">
            <p className="status-eyebrow">SYSTEM STATUS</p>
            <div className="status-hero__header">
              <div>
                <h1>Health check</h1>
                <p>
                  A human-readable view of the public app, deployment health endpoint, and
                  required runtime configuration.
                </p>
              </div>
              <span className={`status-badge status-badge--${tone}`}>{statusLabel(tone)}</span>
            </div>
            <div className="status-actions">
              <a className="btn-primary" href="/api/health">
                Raw JSON
              </a>
              <a className="btn-ghost" href="/">
                Back to landing
              </a>
            </div>
          </section>

          <section aria-label="Status checks" className="container status-grid">
            {checks.map((check) => (
              <article className="status-card" key={check.label}>
                <div className="status-card__header">
                  <h2>{check.label}</h2>
                  <span className={`status-dot status-dot--${check.tone}`} />
                </div>
                <p>{check.summary}</p>
                <code>{check.detail}</code>
              </article>
            ))}
          </section>
        </main>
        <Footer />
      </div>
    </>
  );
}
