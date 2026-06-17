"use client";

import { useEffect, useState } from "react";
import { Check, Plus } from "lucide-react";
import { WORKFLOW_STORAGE_KEY, WORKFLOW_TEMPLATES } from "@/lib/workflow-templates";

function readInstalledWorkflowIds() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WORKFLOW_STORAGE_KEY) ?? "[]") as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((value): value is string =>
      typeof value === "string" && WORKFLOW_TEMPLATES.some((template) => template.id === value)
    );
  } catch {
    return [];
  }
}

function saveInstalledWorkflowIds(ids: string[]) {
  window.localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(Array.from(new Set(ids))));
}

export function WorkflowMarketplace() {
  const [installedIds, setInstalledIds] = useState<string[]>([]);

  useEffect(() => {
    setInstalledIds(readInstalledWorkflowIds());
  }, []);

  function installWorkflow(id: string) {
    const nextIds = Array.from(new Set([...installedIds, id]));

    try {
      saveInstalledWorkflowIds(nextIds);
      setInstalledIds(nextIds);
    } catch {
      setInstalledIds(nextIds);
    }
  }

  return (
    <div className="workflow-grid">
      {WORKFLOW_TEMPLATES.map((template) => {
        const isInstalled = installedIds.includes(template.id);

        return (
          <article className="workflow-card" key={template.id}>
            <div className="workflow-card__header">
              <div>
                <span className="workspace-status-card__eyebrow">{template.category}</span>
                <h2>{template.title}</h2>
              </div>
              <span className={`project-status${isInstalled ? " project-status--ready" : " project-status--running"}`}>
                {isInstalled ? "added" : "available"}
              </span>
            </div>
            <p>{template.description}</p>
            <ol className="workflow-card__steps">
              {template.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <div className="workflow-card__actions">
              <button
                className={isInstalled ? "btn-ghost" : "btn-primary"}
                disabled={isInstalled}
                onClick={() => installWorkflow(template.id)}
                type="button"
              >
                {isInstalled ? <Check size={16} strokeWidth={1.9} /> : <Plus size={16} strokeWidth={1.9} />}
                {isInstalled ? "Added to My Workflows" : "Add to My Workflows"}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
