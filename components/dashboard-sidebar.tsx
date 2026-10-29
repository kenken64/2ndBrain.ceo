"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  ChevronDown,
  Clapperboard,
  Menu,
  MessageSquare,
  ShieldCheck,
  GitBranch,
  ListChecks,
  Languages,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Plug,
  Power,
  ScrollText,
  Settings,
  Store,
  X
} from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { BrandLogo } from "@/components/brand-logo";

type DashboardSidebarProps = {
  activeItem?: "admin" | "chat" | "gateway" | "marketplace" | "remotion" | "wiki" | "graph" | "settings" | "workflows";
  avatarName?: string | null;
  creditLocked?: boolean;
  email?: string | null;
  ownerName?: string | null;
  showAdmin?: boolean;
  showChatActions?: boolean;
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
  const { language } = useLanguage();
  const className = `sidebar-item${active ? " is-active" : ""}${disabled ? " is-disabled" : ""}`;

  if (disabled) {
    return (
      <span aria-disabled="true" className={className} role="link" title={language === "zh" ? "需要 AI 积分" : "AI credits required"}>
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
  showAdmin = false,
  showChatActions = false
}: DashboardSidebarProps) {
  const { language, setLanguage } = useLanguage();
  const zh = language === "zh";
  const sidebarRef = useRef<HTMLElement>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [hasLoadedPreference, setHasLoadedPreference] = useState(false);
  const workspaceOwner = ownerName?.trim() || email?.split("@")[0] || (zh ? "个人" : "Personal");
  const workspaceName = zh ? `${workspaceOwner}的工作空间` : `${workspaceOwner}'s workspace`;
  const toggleLabel = isCollapsed ? (zh ? "展开侧栏" : "Expand sidebar") : (zh ? "收起侧栏" : "Collapse sidebar");
  const mobileToggleLabel = isMobileOpen ? (zh ? "关闭菜单" : "Close menu") : (zh ? "打开菜单" : "Open menu");
  const settingsHref = creditLocked ? "/dashboard/settings?tab=payment" : "/dashboard/settings";

  function closeMobileMenuOnLink(event: MouseEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest("a")) {
      setIsMobileOpen(false);
    }
  }

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
    <aside
      className={`sidebar${isCollapsed ? " is-collapsed" : ""}${isMobileOpen ? " is-mobile-open" : ""}`}
      ref={sidebarRef}
    >
      <div className="sidebar-header">
        <a className="sidebar-brand" href={creditLocked ? settingsHref : "/dashboard"}>
          <BrandLogo size={50} />
        </a>
        <div className="sidebar-header__actions">
          {showChatActions ? <button aria-label={zh ? "新对话" : "New chat"} className="btn-icon sidebar-new-chat" disabled={!hasLoadedPreference} onClick={() => window.dispatchEvent(new CustomEvent("ai-cuber:new-chat"))} title={zh ? "新对话" : "New chat"} type="button"><Plus size={18} strokeWidth={2} /></button> : null}
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
        <button
          aria-controls="dashboard-sidebar-nav"
          aria-expanded={isMobileOpen}
          aria-label={mobileToggleLabel}
          className="btn-icon sidebar-mobile-toggle"
          onClick={() => setIsMobileOpen((open) => !open)}
          title={mobileToggleLabel}
          type="button"
        >
          {isMobileOpen ? <X size={18} strokeWidth={1.8} /> : <Menu size={18} strokeWidth={1.8} />}
        </button>
      </div>
      <button className="workspace-pill" title={workspaceName} type="button">
        <span className="workspace-pill__avatar">{workspaceName.charAt(0).toUpperCase()}</span>
        <span className="workspace-pill__name">{workspaceName}</span>
        <ChevronDown size={15} strokeWidth={1.8} />
      </button>
      <nav
        aria-label={zh ? "工作空间导航" : "Dashboard navigation"}
        className="sidebar-nav"
        id="dashboard-sidebar-nav"
        onClick={closeMobileMenuOnLink}
      >
        <span className="sidebar-section-label">{zh ? "工作空间" : "WORKSPACE"}</span>
        <SidebarNavItem
          active={activeItem === "chat"}
          disabled={creditLocked}
          href="/dashboard/chat"
          icon={<MessageSquare size={18} strokeWidth={1.7} />}
          label={zh ? "AI 对话" : "AI Chat"}
          title={zh ? "AI 对话" : "AI Chat"}
        />
        {showChatActions ? <div className="sidebar-chat-history-slot" id="sidebar-chat-history-slot" /> : null}
        <SidebarNavItem
          active={activeItem === "gateway"}
          disabled={creditLocked}
          href="/dashboard/openclaw"
          icon={<Plug size={18} strokeWidth={1.7} />}
          label={zh ? "AI 助手网关" : "AI Assistant Gateway"}
          title={zh ? "AI 助手网关" : "AI Assistant Gateway"}
        />
        <SidebarNavItem
          active={activeItem === "remotion"}
          disabled={creditLocked}
          href="/dashboard#remotion-avatar"
          icon={<Clapperboard size={18} strokeWidth={1.7} />}
          label={zh ? "我的 AI 形象" : "My AI Avatar"}
          title={zh ? "我的 AI 形象" : "My AI Avatar"}
        />
        <SidebarNavItem
          active={activeItem === "wiki"}
          disabled={creditLocked}
          href="/dashboard/wiki"
          icon={<ScrollText size={18} strokeWidth={1.7} />}
          label={zh ? "Nth Brain" : "Nth Brain"}
          title={zh ? "Nth Brain" : "Nth Brain"}
        />
        <SidebarNavItem
          active={activeItem === "graph"}
          disabled={creditLocked}
          href="/dashboard/graph"
          icon={<GitBranch size={18} strokeWidth={1.7} />}
          label={zh ? "知识图谱" : "Knowledge Graph"}
          title={zh ? "知识图谱" : "Knowledge Graph"}
        />
        <span className="sidebar-section-label sidebar-section-label--nested">{zh ? "工作流" : "WORKFLOW"}</span>
        <SidebarNavItem
          active={activeItem === "marketplace"}
          href="/dashboard/marketplace"
          icon={<Store size={18} strokeWidth={1.7} />}
          label={zh ? "应用市场" : "Marketplace"}
          title={zh ? "应用市场" : "Marketplace"}
        />
        <SidebarNavItem
          active={activeItem === "workflows"}
          href="/dashboard/workflows"
          icon={<ListChecks size={18} strokeWidth={1.7} />}
          label={zh ? "我的工作流" : "My Workflows"}
          title={zh ? "我的工作流" : "My Workflows"}
        />
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-footer" onClick={closeMobileMenuOnLink}>
        <button className="sidebar-item sidebar-language" type="button" onClick={() => setLanguage(zh ? "en" : "zh")} aria-label={zh ? "Switch to English" : "切换到中文"} title={zh ? "Switch to English" : "切换到中文"}><Languages size={18} strokeWidth={1.7} /><span className="sidebar-item__label">{zh ? "English" : "中文"}</span></button>
        <SidebarNavItem
          active={activeItem === "settings"}
          href={settingsHref}
          icon={<Settings size={18} strokeWidth={1.7} />}
          label={zh ? "设置" : "Settings"}
          title={zh ? "设置" : "Settings"}
        />
        {showAdmin || activeItem === "admin" ? (
          <SidebarNavItem
            active={activeItem === "admin"}
            disabled={creditLocked}
            href="/admin"
            icon={<ShieldCheck size={18} strokeWidth={1.7} />}
            label={zh ? "管理" : "Admin"}
            title={zh ? "管理" : "Admin"}
          />
        ) : null}
        <a className="sidebar-item sidebar-item--logout" href="/auth/logout" title={zh ? "退出登录" : "Log out"}>
          <Power size={18} strokeWidth={1.7} />
          <span className="sidebar-item__label">{zh ? "退出登录" : "Log out"}</span>
        </a>
      </div>
    </aside>
  );
}
