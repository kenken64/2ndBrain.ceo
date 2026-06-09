"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  Clapperboard,
  ShieldCheck,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Power,
  ScrollText,
  Settings
} from "lucide-react";
import { BrandHeart } from "@/components/brand-heart";

type DashboardSidebarProps = {
  activeItem?: "admin" | "gateway" | "remotion" | "wiki" | "graph" | "settings";
  avatarName?: string | null;
  creditLocked?: boolean;
  email?: string | null;
  ownerName?: string | null;
  showAdmin?: boolean;
};

const sidebarCollapsedStorageKey = "2ndbrain.sidebarCollapsed";

function readStoredSidebarState() {
  try {
    return window.localStorage.getItem(sidebarCollapsedStorageKey) === "true";
  } catch {
    return false;
  }
}

type SidebarNavItemProps = {
  active: boolean;
  disabled?: boolean;
  href: string;
  icon: ReactNode;
  label: string;
  title: string;
};

function SidebarNavItem({ active, disabled = false, href, icon, label, title }: SidebarNavItemProps) {
  const className = `sidebar-item${active ? " is-active" : ""}${disabled ? " is-disabled" : ""}`;

  if (disabled) {
    return (
      <span aria-disabled="true" className={className} role="link" title="AI credits required">
        {icon}
        <span className="sidebar-item__label">{label}</span>
      </span>
    );
  }

  return (
    <a className={className} href={href} title={title}>
      {icon}
      <span className="sidebar-item__label">{label}</span>
    </a>
  );
}

export function DashboardSidebar({
  activeItem = "gateway",
  creditLocked = false,
  email,
  ownerName,
  showAdmin = false
}: DashboardSidebarProps) {
  const sidebarRef = useRef<HTMLElement>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hasLoadedPreference, setHasLoadedPreference] = useState(false);
  const workspaceOwner = ownerName?.trim() || email?.split("@")[0] || "Personal";
  const workspaceName = `${workspaceOwner}'s workspace`;
  const toggleLabel = isCollapsed ? "Expand sidebar" : "Collapse sidebar";
  const settingsHref = creditLocked ? "/dashboard/settings?tab=payment" : "/dashboard/settings";

  useEffect(() => {
    setIsCollapsed(readStoredSidebarState());
    setHasLoadedPreference(true);
  }, []);

  useEffect(() => {
    const layout = sidebarRef.current?.closest(".dashboard-layout");

    layout?.classList.toggle("is-sidebar-collapsed", isCollapsed);

    return () => {
      layout?.classList.remove("is-sidebar-collapsed");
    };
  }, [isCollapsed]);

  useEffect(() => {
    if (!hasLoadedPreference) {
      return;
    }

    try {
      window.localStorage.setItem(sidebarCollapsedStorageKey, String(isCollapsed));
    } catch {
      // localStorage can be unavailable in privacy-restricted browser contexts.
    }
  }, [hasLoadedPreference, isCollapsed]);

  return (
    <aside className={`sidebar${isCollapsed ? " is-collapsed" : ""}`} ref={sidebarRef}>
      <div className="sidebar-header">
        <a className="sidebar-brand" href={creditLocked ? settingsHref : "/dashboard"}>
          <BrandHeart size={50} />
        </a>
        <button
          aria-controls="dashboard-sidebar-nav"
          aria-expanded={!isCollapsed}
          aria-label={toggleLabel}
          className="btn-icon sidebar-toggle"
          onClick={() => setIsCollapsed((collapsed) => !collapsed)}
          title={toggleLabel}
          type="button"
        >
          {isCollapsed ? (
            <PanelLeftOpen size={16} strokeWidth={1.8} />
          ) : (
            <PanelLeftClose size={16} strokeWidth={1.8} />
          )}
        </button>
      </div>
      <button className="workspace-pill" title={workspaceName} type="button">
        <span className="workspace-pill__avatar">{workspaceName.charAt(0).toUpperCase()}</span>
        <span className="workspace-pill__name">{workspaceName}</span>
        <ChevronDown size={15} strokeWidth={1.8} />
      </button>
      <nav aria-label="Dashboard navigation" className="sidebar-nav" id="dashboard-sidebar-nav">
        <span className="sidebar-section-label">WORKSPACE</span>
        <SidebarNavItem
          active={activeItem === "gateway"}
          disabled={creditLocked}
          href="/dashboard/openclaw"
          icon={<Plug size={18} strokeWidth={1.7} />}
          label="AI Assistant Gateway UI"
          title="AI Assistant Gateway UI"
        />
        <SidebarNavItem
          active={activeItem === "remotion"}
          disabled={creditLocked}
          href="/dashboard#remotion-avatar"
          icon={<Clapperboard size={18} strokeWidth={1.7} />}
          label="My AI Avatar"
          title="My AI Avatar"
        />
        <SidebarNavItem
          active={activeItem === "wiki"}
          disabled={creditLocked}
          href="/dashboard/wiki"
          icon={<ScrollText size={18} strokeWidth={1.7} />}
          label="Nth Brain"
          title="Nth Brain"
        />
        <SidebarNavItem
          active={activeItem === "graph"}
          disabled={creditLocked}
          href="/dashboard/graph"
          icon={<GitBranch size={18} strokeWidth={1.7} />}
          label="Knowledge Graph"
          title="Knowledge Graph"
        />
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-footer">
        <SidebarNavItem
          active={activeItem === "settings"}
          href={settingsHref}
          icon={<Settings size={18} strokeWidth={1.7} />}
          label="Settings"
          title="Settings"
        />
        {showAdmin || activeItem === "admin" ? (
          <SidebarNavItem
            active={activeItem === "admin"}
            disabled={creditLocked}
            href="/admin"
            icon={<ShieldCheck size={18} strokeWidth={1.7} />}
            label="Admin"
            title="Admin"
          />
        ) : null}
        <a className="sidebar-item sidebar-item--logout" href="/auth/logout" title="Log out">
          <Power size={18} strokeWidth={1.7} />
          <span className="sidebar-item__label">Log out</span>
        </a>
      </div>
    </aside>
  );
}
