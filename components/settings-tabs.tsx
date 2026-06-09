"use client";

import { useState, type ReactNode } from "react";
import { CreditCard, PlugZap, Settings } from "lucide-react";

type SettingsTabId = "general" | "integrations" | "payment";

type SettingsTabsProps = {
  general: ReactNode;
  integrations: ReactNode;
  payment: ReactNode;
};

const tabs: Array<{
  icon: typeof Settings;
  id: SettingsTabId;
  label: string;
}> = [
  { icon: Settings, id: "general", label: "General" },
  { icon: PlugZap, id: "integrations", label: "Integrations" },
  { icon: CreditCard, id: "payment", label: "Payment" }
];

export function SettingsTabs({ general, integrations, payment }: SettingsTabsProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("general");
  const panels: Record<SettingsTabId, ReactNode> = {
    general,
    integrations,
    payment
  };

  return (
    <div className="settings-tabs">
      <div aria-label="Settings sections" className="settings-tabs__list" role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              aria-controls={`settings-panel-${tab.id}`}
              aria-selected={isActive}
              className={`settings-tabs__tab${isActive ? " is-active" : ""}`}
              id={`settings-tab-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              type="button"
            >
              <Icon size={16} strokeWidth={1.8} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <section
          aria-labelledby={`settings-tab-${tab.id}`}
          className="settings-tabs__panel"
          hidden={activeTab !== tab.id}
          id={`settings-panel-${tab.id}`}
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
