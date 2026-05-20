"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { BrandHeart } from "@/components/brand-heart";
import { LoginDialog } from "@/components/login-dialog";

type MarketingNavProps = {
  supabaseConfigured?: boolean;
};

export function MarketingNav({ supabaseConfigured = true }: MarketingNavProps) {
  const [isLoginOpen, setIsLoginOpen] = useState(false);

  return (
    <>
      <header className="site-nav">
        <nav aria-label="Primary navigation" className="container site-nav__inner">
          <a className="brand-link" href="/">
            <BrandHeart size={56} />
          </a>
          <div className="nav-links">
            <a className="nav-link" href="#builder">
              Builder
            </a>
            <a className="nav-link" href="#templates">
              Templates
            </a>
            <a className="nav-link" href="#numbers">
              Numbers
            </a>
            <a className="nav-link" href="/onboarding">
              Onboarding
            </a>
          </div>
          <div className="nav-actions">
            <a
              aria-label="Open GitHub repository"
              className="github-link"
              href="https://github.com/kenken64/2ndBrain.ceo"
              rel="noreferrer"
              target="_blank"
            >
              <svg aria-hidden="true" className="github-link__icon" viewBox="0 0 24 24">
                <path
                  clipRule="evenodd"
                  d="M12 .5C5.65.5.5 5.77.5 12.27c0 5.2 3.29 9.6 7.86 11.16.58.11.79-.26.79-.57 0-.28-.01-1.02-.02-2-3.2.71-3.88-1.58-3.88-1.58-.52-1.36-1.28-1.72-1.28-1.72-1.05-.73.08-.72.08-.72 1.16.08 1.77 1.22 1.77 1.22 1.03 1.8 2.71 1.28 3.37.98.1-.76.4-1.28.73-1.58-2.55-.3-5.24-1.31-5.24-5.82 0-1.29.45-2.34 1.19-3.16-.12-.3-.52-1.5.11-3.12 0 0 .98-.32 3.18 1.21a10.75 10.75 0 0 1 5.8 0c2.2-1.53 3.17-1.21 3.17-1.21.64 1.62.24 2.82.12 3.12.74.82 1.19 1.87 1.19 3.16 0 4.52-2.69 5.51-5.25 5.81.41.36.78 1.08.78 2.18 0 1.58-.02 2.85-.02 3.24 0 .32.21.69.8.57A11.79 11.79 0 0 0 23.5 12.27C23.5 5.77 18.35.5 12 .5Z"
                  fill="currentColor"
                  fillRule="evenodd"
                />
              </svg>
            </a>
            <button className="text-link nav-login-button" onClick={() => setIsLoginOpen(true)} type="button">
              Log in
            </button>
            <button className="btn-primary" onClick={() => setIsLoginOpen(true)} type="button">
              Get started <span className="arrow">-&gt;</span>
            </button>
            <button aria-label="Open menu" className="mobile-menu-button" type="button">
              <Menu size={18} strokeWidth={1.8} />
            </button>
          </div>
        </nav>
      </header>

      <LoginDialog
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
        supabaseConfigured={supabaseConfigured}
      />
    </>
  );
}
