import { Atmosphere } from "@/components/atmosphere";
import { ChatInput } from "@/components/chat-input";
import { Footer } from "@/components/footer";
import { MarketingNav } from "@/components/marketing-nav";
import { TemplatesPanel } from "@/components/templates-panel";
import { hasSupabaseEnv } from "@/lib/env";

const steps = [
  {
    title: "Describe the system",
    description: "Start with a goal, a workflow, or a messy pile of notes."
  },
  {
    title: "Shape the output",
    description: "2ndBrain drafts pages, trackers, rituals, and decision logs."
  },
  {
    title: "Run it with your team",
    description: "Keep the operating system alive with projects and recurring prompts."
  }
];

const stats = [
  ["12k+", "workflows generated"],
  ["4.8x", "faster knowledge retrieval"],
  ["91%", "teams shipping weekly reviews"]
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
                <span>Knowledge overload?</span>
                <span>Let Nth Brain organize it.</span>
              </h1>
              <p className="hero__subhead">
                Create dashboards, rituals, and knowledge workflows by chatting with an AI
                builder that understands founder context.
              </p>
              <ChatInput
                action="/intent"
                className="hero__chat"
                method="get"
                placeholder="Ask 2ndBrain to turn my notes into a weekly operating dashboard..."
              />
              <div className="trust-strip">
                Built for fast-moving teams
                <div aria-hidden="true" className="trust-strip__logos">
                  <span>Founders</span>
                  <span>Ops</span>
                  <span>Product</span>
                  <span>Sales</span>
                  <span>Strategy</span>
                </div>
              </div>
            </div>
          </section>

          <section className="section" id="builder">
            <div className="container">
              <h2 className="section-heading">AI App Builder</h2>
              <p className="section-copy">
                The first screen is the product: a chat-led workspace that turns intent into
                useful company surfaces.
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

          <section className="section">
            <div className="container">
              <TemplatesPanel />
            </div>
          </section>

          <section className="section" id="numbers">
            <div className="container">
              <h2 className="section-heading">2ndBrain in numbers</h2>
              <div className="stats-grid">
                {stats.map(([value, label]) => (
                  <div className="stat-card" key={label}>
                    <strong>{value}</strong>
                    <span>{label}</span>
                  </div>
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
