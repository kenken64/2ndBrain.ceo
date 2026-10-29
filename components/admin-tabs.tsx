"use client";

import { useLanguage } from "@/components/language-provider";

import { useState, type ReactNode } from "react";
import { CreditCard, Users } from "lucide-react";

export type AdminTabId = "users" | "billing";

type AdminTabsProps = {
  billing: ReactNode;
  initialTab?: AdminTabId;
  users: ReactNode;
};

const tabs: Array<{
  icon: typeof Users;
  id: AdminTabId;
  label: string;
}> = [
  { icon: Users, id: "users", label: "Users" },
  { icon: CreditCard, id: "billing", label: "Billing" }
];

/**
 * Splits the admin workbench into tabs. Panels are rendered server-side and
 * passed in, so switching tabs costs no refetch. Styling reuses the
 * .settings-tabs rules, which are presentational rather than settings-specific.
 */
export function AdminTabs({ billing, initialTab, users }: AdminTabsProps) {
  const _uiLanguage = useLanguage().language;
  const [activeTab, setActiveTab] = useState<AdminTabId>(initialTab ?? "users");
  const panels: Record<AdminTabId, ReactNode> = { billing, users };

  return (
    <div className="settings-tabs">
      <div aria-label={_uiLanguage === "zh" ? "管理分类" : "Admin sections"} className="settings-tabs__list" role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              aria-controls={`admin-panel-${tab.id}`}
              aria-selected={isActive}
              className={`settings-tabs__tab${isActive ? " is-active" : ""}`}
              id={`admin-tab-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              type="button"
            >
              <Icon size={16} strokeWidth={1.8} />
              {_uiLanguage === "zh" ? (tab.id === "users" ? "用户" : "账单") : tab.label}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <section
          aria-labelledby={`admin-tab-${tab.id}`}
          className="settings-tabs__panel"
          hidden={activeTab !== tab.id}
          id={`admin-panel-${tab.id}`}
          key={tab.id}
          role="tabpanel"
          tabIndex={0}
        >
          {panels[tab.id]}
        </section>
      ))}
    </div>
  );
}
