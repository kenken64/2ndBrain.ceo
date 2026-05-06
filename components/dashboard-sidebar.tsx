import {
  ChevronDown,
  Compass,
  Home,
  Inbox,
  LayoutGrid,
  Plug,
  Search,
  Star,
  UserRound,
  UsersRound
} from "lucide-react";
import { BrandHeart } from "@/components/brand-heart";

type DashboardSidebarProps = {
  avatarName?: string | null;
  email?: string | null;
};

export function DashboardSidebar({ avatarName, email }: DashboardSidebarProps) {
  const workspaceOwner = avatarName?.trim() || email?.split("@")[0] || "Personal";
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
        <a className="sidebar-item is-active" href="/dashboard">
          <Home size={18} strokeWidth={1.7} />
          Home
        </a>
        <a className="sidebar-item" href="/dashboard">
          <Search size={18} strokeWidth={1.7} />
          Search
        </a>
        <a className="sidebar-item" href="/dashboard">
          <Compass size={18} strokeWidth={1.7} />
          Resources
        </a>
        <a className="sidebar-item" href="/dashboard">
          <Plug size={18} strokeWidth={1.7} />
          Connectors
        </a>
        <span className="sidebar-section-label">PROJECTS</span>
        <a className="sidebar-item" href="/dashboard">
          <LayoutGrid size={18} strokeWidth={1.7} />
          All projects
        </a>
        <a className="sidebar-item" href="/dashboard">
          <Star size={18} strokeWidth={1.7} />
          Starred
        </a>
        <a className="sidebar-item" href="/dashboard">
          <UserRound size={18} strokeWidth={1.7} />
          Created by me
        </a>
        <a className="sidebar-item" href="/dashboard">
          <UsersRound size={18} strokeWidth={1.7} />
          Shared with me
        </a>
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-card">
        <strong>Share 2ndBrain</strong>
        <span>Invite collaborators into your workspace.</span>
      </div>
      <div className="sidebar-card">
        <strong>Upgrade to Pro</strong>
        <span>More projects, connectors, and automations.</span>
      </div>
      <a className="sidebar-item" href="/auth/logout">
        <Inbox size={18} strokeWidth={1.7} />
        Sign out
      </a>
    </aside>
  );
}
