"use client";

import { useEffect, useRef, useState } from "react";
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

export function DashboardSidebar({ activeItem = "gateway", email, ownerName, showAdmin = false }: DashboardSidebarProps) {
  const sidebarRef = useRef<HTMLElement>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hasLoadedPreference, setHasLoadedPreference] = useState(false);
  const workspaceOwner = ownerName?.trim() || email?.split("@")[0] || "Personal";
  const workspaceName = `${workspaceOwner}'s workspace`;
  const toggleLabel = isCollapsed ? "Expand sidebar" : "Collapse sidebar";

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
        <a className="sidebar-brand" href="/dashboard">
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
        <a className={`sidebar-item${activeItem === "gateway" ? " is-active" : ""}`} href="/dashboard/openclaw" title="AI Assistant Gateway UI">
          <Plug size={18} strokeWidth={1.7} />
          <span className="sidebar-item__label">AI Assistant Gateway UI</span>
        </a>
        <a className={`sidebar-item${activeItem === "remotion" ? " is-active" : ""}`} href="/dashboard#remotion-avatar" title="My AI Avatar">
          <Clapperboard size={18} strokeWidth={1.7} />
          <span className="sidebar-item__label">My AI Avatar</span>
        </a>
        <a className={`sidebar-item${activeItem === "wiki" ? " is-active" : ""}`} href="/dashboard/wiki" title="Nth Brain">
          <ScrollText size={18} strokeWidth={1.7} />
          <span className="sidebar-item__label">Nth Brain</span>
        </a>
        <a className={`sidebar-item${activeItem === "graph" ? " is-active" : ""}`} href="/dashboard/graph" title="Knowledge Graph">
          <GitBranch size={18} strokeWidth={1.7} />
          <span className="sidebar-item__label">Knowledge Graph</span>
        </a>
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-footer">
        <a className={`sidebar-item${activeItem === "settings" ? " is-active" : ""}`} href="/dashboard/settings" title="Settings">
          <Settings size={18} strokeWidth={1.7} />
          <span className="sidebar-item__label">Settings</span>
        </a>
        {showAdmin || activeItem === "admin" ? (
          <a className={`sidebar-item${activeItem === "admin" ? " is-active" : ""}`} href="/admin" title="Admin">
            <ShieldCheck size={18} strokeWidth={1.7} />
            <span className="sidebar-item__label">Admin</span>
          </a>
        ) : null}
        <a className="sidebar-item sidebar-item--logout" href="/auth/logout" title="Log out">
          <Power size={18} strokeWidth={1.7} />
          <span className="sidebar-item__label">Log out</span>
        </a>
      </div>
    </aside>
  );
}
