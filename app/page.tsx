import { Atmosphere } from "@/components/atmosphere";
import { ChatInput } from "@/components/chat-input";
import { Footer } from "@/components/footer";
import { MarketingNav } from "@/components/marketing-nav";
import { hasSupabaseEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const steps = [
  {
    title: "Start With Intent",
    description: "Describe the company memory you need: a project wiki, operating notes, a decision trail, or a focused knowledge graph."
  },
  {
    title: "Connect The Workspace",
    description: "Onboarding connects your profile, Telegram approval, avatar settings, and an AI Agent workspace before heavier actions run."
  },
  {
    title: "Turn Notes Into Structure",
    description: "Upload files or write prompts, then review the generated markdown pages, wiki tree, and graph instead of treating AI output as final."
  }
];

const setupItems = [
  {
    label: "Identity",
    title: "Name, avatar, and owner context",
    description: "The app stores basic profile details so generated workspace pages can use consistent names and references."
  },
  {
    label: "Approval",
    title: "Telegram pairing",
    description: "Telegram approval is used as a human checkpoint before the connected AI Agent continues sensitive setup work."
  },
  {
    label: "Runtime",
    title: "AI Agent on AWS Lightsail",
    description: "Provisioning restores a configured Lightsail snapshot and gives the dashboard a workspace to read, write, export, and inspect."
  }
];

const workspaceItems = [
  {
    title: "LLM Wiki",
    description: "Create a wiki project from a prompt and optional source files, then edit the generated markdown directly."
  },
  {
    title: "Knowledge Graph",
    description: "Sync wiki pages into graph tables and explore concepts, page relationships, and links visually."
  },
  {
    title: "AI Agent Gateway",
    description: "Check gateway status, refresh URLs, reconnect Fronttier AI Model, and open the authenticated SSH console when configured."
  }
];

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Atmosphere />
      <div className="page-shell">
        <MarketingNav supabaseConfigured={hasSupabaseEnv()} />
        <main id="main-content">
          <section className="hero">
            <div className="container hero__inner">
              <h1 className="hero__headline">
                <span>2ndBrain.ceo</span>
              </h1>
              <p className="hero__subhead">
                A workspace for learning how your notes, files, Telegram approval, AI Agent
                runtime, markdown wiki, and knowledge graph fit together before you ask AI to
                generate anything important.
              </p>
              <ChatInput
                action="/intent"
                className="hero__chat"
                method="get"
                placeholder="Describe a project, upload source notes, or ask for an LLM Wiki about a specific operating problem..."
              />
              <div className="trust-strip">
                Learn the workflow before running it
                <div aria-hidden="true" className="trust-strip__logos">
                  <span>Onboarding</span>
                  <span>Telegram</span>
                  <span>AI Agent</span>
                  <span>LLM Wiki</span>
                  <span>Knowledge Graph</span>
                </div>
              </div>
            </div>
          </section>

          <section className="section" id="how-it-works">
            <div className="container">
              <h2 className="section-heading">How 2ndBrain Works</h2>
              <p className="section-copy">
                The app is not a magic app builder. It is a guided workflow for converting
                source material into a maintained workspace you can inspect and revise.
              </p>
              <div className="steps-grid">
                {steps.map((step) => (
                  <article className="step-card" key={step.title}>
                    <div className="step-card__mock">
                      <div className="mock-window">
                        <div className="mock-dots">
                          <span />
                          <span />
                          <span />
                        </div>
                        <div className="mock-line short" />
                        <div className="mock-line medium" />
                        <div className="mock-line" />
                        <div className="mock-card-row">
                          <div className="mock-card" />
                          <div className="mock-card" />
                          <div className="mock-card" />
                        </div>
                      </div>
                    </div>
                    <div className="step-card__body">
                      <h3>{step.title}</h3>
                      <p>{step.description}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="section" id="setup">
            <div className="container">
              <h2 className="section-heading">What Setup Connects</h2>
              <p className="section-copy">
                Setup is explicit because the app coordinates user identity, approval, cloud
                runtime state, and generated workspace files.
              </p>
              <div className="education-grid">
                {setupItems.map((item) => (
                  <article className="education-card" key={item.title}>
                    <span className="education-card__label">{item.label}</span>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="section" id="workspace">
            <div className="container">
              <h2 className="section-heading">Inside The Workspace</h2>
              <p className="section-copy">
                After onboarding, the dashboard focuses on concrete surfaces: wiki projects,
                markdown editing, graph exploration, gateway status, and settings.
              </p>
              <div className="workspace-grid">
                {workspaceItems.map((item) => (
                  <article className="workspace-card" key={item.title}>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

        </main>
        <Footer />
      </div>
    </>
  );
}
