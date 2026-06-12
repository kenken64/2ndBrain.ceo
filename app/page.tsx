import { Manrope } from "next/font/google";
import {
  Briefcase,
  Coins,
  Download,
  KeyRound,
  PencilLine,
  Send,
  Terminal,
  Trash2,
  Video
} from "lucide-react";
import { Atmosphere } from "@/components/atmosphere";
import { ChatInput } from "@/components/chat-input";
import { Footer } from "@/components/footer";
import { MarketingNav } from "@/components/marketing-nav";
import { hasSupabaseEnv } from "@/lib/env";
import { BootRail } from "@/components/landing/boot-rail";
import { ExportProof } from "@/components/landing/export-proof";
import { OperatingRoom } from "@/components/landing/operating-room";
import { RECORD } from "@/components/landing/record";
import { Reveal } from "@/components/landing/reveal";
import { WorkspaceRail } from "@/components/landing/workspace-rail";
import "./landing.css";

export const dynamic = "force-dynamic";

const manrope = Manrope({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-manrope",
  weight: ["400", "500", "600", "700", "800"]
});

const runsOn = ["AWS LIGHTSAIL", "SUPABASE", "TELEGRAM", "GOOGLE WORKSPACE", "SOLANA"];

const ownershipRows = [
  {
    icon: PencilLine,
    tint: "blue",
    title: "Edit",
    body: "Every generated page is plain markdown. Rewrite anything; your version wins."
  },
  {
    icon: Download,
    tint: "green",
    title: "Export",
    body: "Take the entire wiki out as files. No proprietary format, no exit interview."
  },
  {
    icon: Trash2,
    tint: "orange",
    title: "Delete",
    body: "Removing a project removes its workspace folder too. Gone means gone."
  }
] as const;

const integrations = [
  { icon: Briefcase, name: "Google Workspace", sub: "agent-side credentials via Google OAuth" },
  { icon: Send, name: "Telegram", sub: "pairing + approval gate" },
  { icon: Terminal, name: "SSH Console", sub: "authenticated, in-dashboard" },
  { icon: Video, name: "Remotion Avatar", sub: "a face for your agent" },
  { icon: KeyRound, name: "Google OAuth", sub: "sign-in through Supabase" },
  { icon: Coins, name: "Solana", sub: "credit top-ups on-chain" }
] as const;

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Atmosphere />
      <div className={`page-shell lp-type ${manrope.variable}`}>
        <MarketingNav supabaseConfigured={hasSupabaseEnv()} />
        <main id="main-content">
          {/* ---- Hero: the intent console ---- */}
          <section className="lp-hero">
            <div className="container lp-hero__grid">
              <div className="lp-hero__main">
                <p className="lp-hero__kicker">
                  YOUR OWN AGENT · YOUR OWN MACHINE · YOUR APPROVAL
                </p>
                <h1 className="lp-hero__h1">
                  <span className="lp-hero__line">
                    <span className="lp-hero__line-inner">Everything your agent knows.</span>
                  </span>
                  <span className="lp-hero__line">
                    <span className="lp-hero__line-inner lp-hero__line-inner--2">
                      In a{" "}
                      <span className="lp-underline-wrap">
                        wiki you own
                        <svg
                          aria-hidden="true"
                          className="lp-underline"
                          focusable="false"
                          preserveAspectRatio="none"
                          viewBox="0 0 300 14"
                        >
                          <path d="M4 10 C 64 3, 152 13, 296 5" fill="none" pathLength={1} />
                        </svg>
                      </span>
                      .
                    </span>
                  </span>
                </h1>
                <p className="lp-hero__sub">
                  2ndBrain.ceo provisions a dedicated AI agent on AWS Lightsail, then writes
                  everything it learns into editable markdown — wiki pages, a per-project
                  knowledge graph, and a Telegram approval gate you hold. Read it. Edit it.
                  Export it. It&rsquo;s yours.
                </p>
                <svg
                  aria-hidden="true"
                  className="lp-traces"
                  focusable="false"
                  viewBox="0 0 520 300"
                >
                  <path className="lp-traces__path" d="M16 0 V96 H210 V190" pathLength={1} />
                  <path className="lp-traces__path lp-traces__path--2" d="M70 0 V140 H320 V236" pathLength={1} />
                  <path className="lp-traces__path lp-traces__path--3" d="M130 0 V60 H440 V214" pathLength={1} />
                  <path className="lp-traces__flow" d="M16 0 V96 H210 V190" pathLength={1} />
                  <path className="lp-traces__flow lp-traces__flow--2" d="M70 0 V140 H320 V236" pathLength={1} />
                  <circle className="lp-traces__node" cx="210" cy="190" r="3.5" />
                  <circle className="lp-traces__node" cx="320" cy="236" r="3.5" />
                  <circle className="lp-traces__node" cx="440" cy="214" r="3.5" />
                  <circle className="lp-traces__node" cx="16" cy="96" r="2.5" />
                  <circle className="lp-traces__node" cx="130" cy="60" r="2.5" />
                </svg>
                <ChatInput
                  action="/intent"
                  className="lp-hero-chat"
                  method="get"
                  placeholder="Brief your agent: 'Build an operating wiki for our vendor contracts and flag every renewal date…'"
                />
                <p className="lp-hero__caption">
                  Your prompt becomes a wiki project — markdown pages you can read, edit, and
                  export, plus a knowledge graph you can drag around. Source files attach on the
                  next screen.
                </p>
                <p className="lp-status">
                  agent: idle — awaiting intent{" "}
                  <span aria-hidden="true" className="lp-status__cursor">
                    ▍
                  </span>
                </p>
                <div className="lp-runs-on">
                  <span className="lp-runs-on__label">Runs on</span>
                  {runsOn.map((name, index) => (
                    <span
                      className="lp-runs-on__item"
                      key={name}
                      style={{ animationDelay: `${1100 + index * 60}ms` }}
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
              <span aria-hidden="true" className="lp-hero__annot">
                MEMORY: MARKDOWN · RUNTIME: AWS LIGHTSAIL · GATE: TELEGRAM
              </span>
            </div>
          </section>

          {/* ---- The Operating Room ---- */}
          <section aria-labelledby="lp-h-how" className="lp-section" id="how-it-works">
            <div className="container">
              <Reveal as="header" className="lp-sec-head">
                <p className="lp-kicker">HOW IT WORKS</p>
                <h2 className="lp-h2" id="lp-h-how">
                  No black box. This is the machine.
                </h2>
                <p className="lp-lead">
                  One intent becomes a wiki, a graph, and a gated action — replayed in miniature
                  below, including the part where nothing runs until someone says go. These are
                  the real surfaces you&rsquo;ll use.
                </p>
              </Reveal>
              <OperatingRoom />
            </div>
          </section>

          {/* ---- Boot Sequence ---- */}
          <section aria-labelledby="lp-h-setup" className="lp-section" id="setup">
            <div className="container">
              <BootRail />
            </div>
          </section>

          {/* ---- Three Rooms ---- */}
          <section aria-labelledby="lp-h-workspace" className="lp-section" id="workspace">
            <div className="container">
              <WorkspaceRail />
            </div>
          </section>

          {/* ---- Exit Is a Feature ---- */}
          <section aria-labelledby="lp-h-ownership" className="lp-section" id="ownership">
            <div className="container">
              <Reveal className="lp-own">
                <header className="lp-sec-head lp-sec-head--inset">
                  <p className="lp-kicker">OWNERSHIP</p>
                  <h2 className="lp-h2" id="lp-h-ownership">
                    If you can&rsquo;t edit it, export it, and delete it — you don&rsquo;t own
                    it.
                  </h2>
                </header>
                <div className="lp-own__grid">
                  <div className="lp-own__rows">
                    {ownershipRows.map((row) => {
                      const Icon = row.icon;

                      return (
                        <div className="lp-own-row" key={row.title}>
                          <span
                            aria-hidden="true"
                            className={`lp-own-row__icon lp-own-row__icon--${row.tint}`}
                          >
                            <Icon size={19} strokeWidth={1.8} />
                          </span>
                          <div>
                            <h3>{row.title}</h3>
                            <p>{row.body}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <ExportProof />
                </div>
                <p className="lp-footline">teardown is one click. export first. no hostages.</p>
              </Reveal>
            </div>
          </section>

          {/* ---- Wired In ---- */}
          <section aria-labelledby="lp-h-integrations" className="lp-section" id="integrations">
            <div className="container">
              <Reveal as="header" className="lp-sec-head">
                <p className="lp-kicker">INTEGRATIONS</p>
                <h2 className="lp-h2" id="lp-h-integrations">
                  Wired in, not walled in.
                </h2>
              </Reveal>
              <div className="lp-int-grid">
                {integrations.map((item, index) => {
                  const Icon = item.icon;

                  return (
                    <Reveal className="lp-int-chip" delay={index * 45} key={item.name}>
                      <span aria-hidden="true" className="lp-int-chip__icon">
                        <Icon size={18} strokeWidth={1.8} />
                      </span>
                      <span className="lp-int-chip__name">{item.name}</span>
                      <span className="lp-int-chip__sub">{item.sub}</span>
                      <span aria-hidden="true" className="lp-int-chip__dot" />
                    </Reveal>
                  );
                })}
              </div>
              <Reveal as="p" className="lp-footline" delay={300}>
                every jack on this panel ships today. nothing here is &quot;coming soon&quot;.
              </Reveal>
            </div>
          </section>

          {/* ---- Final CTA ---- */}
          <section aria-labelledby="lp-h-start" className="lp-section" id="start">
            <div className="container">
              <Reveal className="lp-start-card">
                <p className="lp-start__status">
                  agent: ready — awaiting intent{" "}
                  <span aria-hidden="true" className="lp-status__cursor">
                    ▍
                  </span>
                </p>
                <h2 className="lp-h2 lp-start__h2" id="lp-h-start">
                  Give it something worth remembering.
                </h2>
                <div className="lp-start__actions">
                  <a className="btn-primary" href="/intent">
                    Start with intent <span className="arrow">-&gt;</span>
                  </a>
                  <a className="btn-ghost" href="/onboarding">
                    Walk through onboarding
                  </a>
                </div>
                <p className="lp-start__files">
                  PDF · DOCX · TXT · MD · images — up to 8 files, 12 MB each.
                </p>
                <div aria-hidden="true" className="lp-start__rule" />
                <p className="lp-start__ledger">{RECORD.ledger}</p>
              </Reveal>
            </div>
          </section>
        </main>
        <Footer />
      </div>
    </>
  );
}
