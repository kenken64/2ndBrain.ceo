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
