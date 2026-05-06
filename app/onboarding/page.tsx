import { BriefcaseBusiness, Building2, UserRound, UsersRound } from "lucide-react";
import { Atmosphere } from "@/components/atmosphere";
import { BrandHeart } from "@/components/brand-heart";

const options = [
  ["Solo", UserRound],
  ["2-20", UsersRound],
  ["21-200", BriefcaseBusiness],
  ["200+", Building2]
] as const;

export default function OnboardingPage() {
  return (
    <>
      <Atmosphere />
      <main className="onboarding-page">
        <section className="onboarding-card">
          <BrandHeart size={120} />
          <h1 className="onboarding-title">How many people work at your company?</h1>
          <div className="option-grid">
            {options.map(([label, Icon], index) => (
              <button
                aria-pressed={index === 1}
                className={`option-card ${index === 1 ? "is-selected" : ""}`}
                key={label}
                type="button"
              >
                <Icon size={28} strokeWidth={1.7} />
                {label}
              </button>
            ))}
          </div>
          <p className="auth-panel__footnote">This page mirrors the onboarding surface from design.md.</p>
          <a className="btn-primary" href="/auth/login?next=/dashboard">
            Next <span className="arrow">-&gt;</span>
          </a>
          <div aria-hidden="true" className="pagination">
            <span className="pagination-dot" />
            <span className="pagination-dot current" />
            <span className="pagination-dot" />
            <span className="pagination-dot" />
          </div>
        </section>
      </main>
    </>
  );
}
