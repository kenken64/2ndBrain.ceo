import { LanguageToggle, Localized, LocalizedMessage, LocalizedContainer } from "@/components/language-provider";
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
            <LanguageToggle /><p className="status-eyebrow"><Localized en="SYSTEM STATUS" zh="系统状态" /></p>
            <div className="status-hero__header">
              <div>
                <h1><Localized en="Health check" zh="健康检查" /></h1>
                <p>
                  <Localized en="A human-readable view of the public app, deployment health endpoint, and required runtime configuration." zh="以易读的方式查看公开应用、部署健康检查端点和所需的运行时配置。" />
                </p>
              </div>
              <span className={`status-badge status-badge--${tone}`}><LocalizedMessage text={statusLabel(tone)} /></span>
            </div>
            <div className="status-actions">
              <a className="btn-primary" href="/api/health">
                <Localized en="Raw JSON" zh="原始 JSON" />
              </a>
              <a className="btn-ghost" href="/">
                <Localized en="Back to landing" zh="返回首页" />
              </a>
            </div>
          </section>

          <LocalizedContainer as="section" labelEn="Status checks" labelZh="状态检查" className="container status-grid">
            {checks.map((check) => (
              <article className="status-card" key={check.label}>
                <div className="status-card__header">
                  <h2><LocalizedMessage text={check.label} /></h2>
                  <span className={`status-dot status-dot--${check.tone}`} />
                </div>
                <p><LocalizedMessage text={check.summary} /></p>
                <code><Localized en={check.detail} zh={check.detail.replace(/^Generated at /, "生成时间：").replaceAll("Source: not configured", "来源：未配置").replaceAll("Source: ", "来源：").replace("configure NEXT_PUBLIC_SITE_URL or RAILWAY_PUBLIC_DOMAIN", "配置 NEXT_PUBLIC_SITE_URL 或 RAILWAY_PUBLIC_DOMAIN")} /></code>
              </article>
            ))}
          </LocalizedContainer>
        </main>
        <Footer />
      </div>
    </>
  );
}
