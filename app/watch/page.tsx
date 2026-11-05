import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Atmosphere } from "@/components/atmosphere";
import { Footer } from "@/components/footer";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingVideo } from "@/components/marketing-video";
import { hasSupabaseEnv, isWechatLoginEnabled } from "@/lib/env";
import "../landing.css";

export const metadata: Metadata = {
  title: "Watch AI CUBER",
  description: "Watch the 45-second AI CUBER introduction."
};

export default async function WatchPage({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const params = await searchParams;
  const storedLocale = (await cookies()).get("aicuber_landing_locale")?.value;
  const locale = (params.lang === "en" || params.lang === "zh" ? params.lang : storedLocale) === "zh" ? "zh" : "en";
  const zh = locale === "zh";
  const home = zh ? "/?lang=zh" : "/";
  return <>
    <a className="skip-link" href="#main-content">{zh ? "跳至主要内容" : "Skip to content"}</a>
    <Atmosphere />
    <div className="page-shell lp-type">
      <MarketingNav locale={locale} anchorPrefix={home} supabaseConfigured={hasSupabaseEnv()} wechatEnabled={isWechatLoginEnabled()} />
      <main id="main-content" className="lp-video-page container">
        <a className="lp-video-back" href={home}><ArrowLeft size={16} aria-hidden="true" />{zh ? "返回首页" : "Back to home"}</a>
        <header className="lp-video-heading"><p className="lp-kicker">{zh ? "认识 AI CUBER · 45 秒" : "MEET AI CUBER · 45 SECONDS"}</p><h1 className="lp-h2">{zh ? "看看 AI CUBER 如何工作。" : "See AI CUBER in action."}</h1><p className="lp-lead">{zh ? "观看我们的简短介绍，探索您的 AI 工作空间。" : "Watch our short introduction and explore your AI workspace."}</p></header>
        <MarketingVideo locale={locale} />
        <div className="lp-video-actions"><a className="btn-primary" href="/onboarding">{zh ? "立即开始" : "Get started"}<ArrowRight size={17} aria-hidden="true" /></a><a className="btn-ghost" href={`${home}#features`}>{zh ? "探索产品功能" : "Explore features"}</a></div>
      </main>
      <Footer locale={locale} />
    </div>
  </>;
}
