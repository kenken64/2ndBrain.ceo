import { Menu } from "lucide-react";
import { BrandHeart } from "@/components/brand-heart";

export function MarketingNav() {
  return (
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
          <a className="text-link" href="/login">
            Log in
          </a>
          <a className="btn-primary" href="/auth/login?next=/dashboard">
            Get started <span className="arrow">-&gt;</span>
          </a>
          <button aria-label="Open menu" className="mobile-menu-button" type="button">
            <Menu size={18} strokeWidth={1.8} />
          </button>
        </div>
      </nav>
    </header>
  );
}
