import {
  ChevronDown,
  Clapperboard,
  GitBranch,
  LayoutGrid,
  Plug,
  Power,
  ScrollText,
  Settings
} from "lucide-react";
import { BrandHeart } from "@/components/brand-heart";

type DashboardSidebarProps = {
  activeItem?: "gateway" | "remotion" | "wiki" | "graph" | "settings";
  avatarName?: string | null;
  email?: string | null;
  ownerName?: string | null;
};

export function DashboardSidebar({ activeItem = "gateway", email, ownerName }: DashboardSidebarProps) {
  const workspaceOwner = ownerName?.trim() || email?.split("@")[0] || "Personal";
  const workspaceName = `${workspaceOwner}'s workspace`;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <a className="sidebar-brand" href="/dashboard">
          <BrandHeart size={50} />
        </a>
        <button aria-label="Collapse sidebar" className="btn-icon" type="button">
          <LayoutGrid size={16} strokeWidth={1.8} />
        </button>
      </div>
      <button className="workspace-pill" type="button">
        <span className="workspace-pill__avatar">{workspaceName.charAt(0).toUpperCase()}</span>
        <span className="workspace-pill__name">{workspaceName}</span>
        <ChevronDown size={15} strokeWidth={1.8} />
      </button>
      <nav aria-label="Dashboard navigation" className="sidebar-nav">
        <span className="sidebar-section-label">WORKSPACE</span>
        <a className={`sidebar-item${activeItem === "gateway" ? " is-active" : ""}`} href="/dashboard/openclaw">
          <Plug size={18} strokeWidth={1.7} />
          OpenClaw Gateway UI
        </a>
        <a className={`sidebar-item${activeItem === "remotion" ? " is-active" : ""}`} href="/dashboard#remotion-avatar">
          <Clapperboard size={18} strokeWidth={1.7} />
          Remotion AI Assistant
        </a>
        <a className={`sidebar-item${activeItem === "wiki" ? " is-active" : ""}`} href="/dashboard/wiki">
          <ScrollText size={18} strokeWidth={1.7} />
          Nth Brain
        </a>
        <a className={`sidebar-item${activeItem === "graph" ? " is-active" : ""}`} href="/dashboard/graph">
          <GitBranch size={18} strokeWidth={1.7} />
          Knowledge Graph
        </a>
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-footer">
        <a className={`sidebar-item${activeItem === "settings" ? " is-active" : ""}`} href="/dashboard/settings">
          <Settings size={18} strokeWidth={1.7} />
          Settings
        </a>
        <a className="sidebar-item sidebar-item--logout" href="/auth/logout">
          <Power size={18} strokeWidth={1.7} />
          Log out
        </a>
      </div>
    </aside>
  );
}
