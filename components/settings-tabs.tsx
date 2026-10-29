"use client";

import { useState, type ReactNode } from "react";
import { translateUiMessage } from "@/lib/ui-messages";
import { useLanguage } from "@/components/language-provider";
import { CreditCard, PlugZap, Settings } from "lucide-react";

export type SettingsTabId = "general" | "integrations" | "payment";

type SettingsTabsProps = {
  disabledReason?: string;
  disabledTabs?: SettingsTabId[];
  general: ReactNode;
  initialTab?: SettingsTabId;
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

function resolveActiveTab(initialTab: SettingsTabId | undefined, disabledTabs: SettingsTabId[]) {
  const requestedTab = initialTab ?? "general";

  if (!disabledTabs.includes(requestedTab)) {
    return requestedTab;
  }

  return tabs.find((tab) => !disabledTabs.includes(tab.id))?.id ?? "general";
}

export function SettingsTabs({
  disabledReason = "Unavailable",
  disabledTabs = [],
  general,
  initialTab,
  integrations,
  payment
}: SettingsTabsProps) {
  const { language } = useLanguage();
  const labels = language === "zh" ? { general: "常规", integrations: "集成", payment: "付款" } : { general: "General", integrations: "Integrations", payment: "Payment" };
  const [activeTab, setActiveTab] = useState<SettingsTabId>(() =>
    resolveActiveTab(initialTab, disabledTabs)
  );
  const activeTabId = disabledTabs.includes(activeTab)
    ? resolveActiveTab(initialTab, disabledTabs)
    : activeTab;
  const panels: Record<SettingsTabId, ReactNode> = {
    general,
    integrations,
    payment
  };

  return (
    <div className="settings-tabs">
      <div aria-label={language === "zh" ? "设置分类" : "Settings sections"} className="settings-tabs__list" role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTabId === tab.id;
          const isDisabled = disabledTabs.includes(tab.id);

          return (
            <button
              aria-controls={`settings-panel-${tab.id}`}
              aria-disabled={isDisabled}
              aria-selected={isActive}
              className={`settings-tabs__tab${isActive ? " is-active" : ""}`}
              disabled={isDisabled}
              id={`settings-tab-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              title={isDisabled ? translateUiMessage(disabledReason, language) : labels[tab.id]}
              type="button"
            >
              <Icon size={16} strokeWidth={1.8} />
              {labels[tab.id]}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <section
          aria-labelledby={`settings-tab-${tab.id}`}
          className="settings-tabs__panel"
          hidden={activeTabId !== tab.id}
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
