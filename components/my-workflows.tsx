"use client";

import { useEffect, useMemo, useState } from "react";
import { Store, Trash2 } from "lucide-react";
import {
  WORKFLOW_STORAGE_KEY,
  WORKFLOW_TEMPLATES,
  workflowTemplateById,
  type WorkflowTemplate
} from "@/lib/workflow-templates";

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

function workflowFromId(id: string): WorkflowTemplate | null {
  return workflowTemplateById(id);
}

export function MyWorkflows() {
  const [installedIds, setInstalledIds] = useState<string[]>([]);
  const workflows = useMemo(
    () => installedIds.map(workflowFromId).filter((workflow): workflow is WorkflowTemplate => Boolean(workflow)),
    [installedIds]
  );

  useEffect(() => {
    setInstalledIds(readInstalledWorkflowIds());
  }, []);

  function removeWorkflow(id: string) {
    const nextIds = installedIds.filter((installedId) => installedId !== id);

    try {
      saveInstalledWorkflowIds(nextIds);
      setInstalledIds(nextIds);
    } catch {
      setInstalledIds(nextIds);
    }
  }

  if (workflows.length === 0) {
    return (
      <article className="workflow-empty">
        <div>
          <p className="workspace-status-card__eyebrow">My Workflows</p>
          <h2>No workflows added</h2>
          <p>Add workflow templates from Marketplace, then manage them here.</p>
        </div>
        <a className="btn-primary" href="/dashboard/marketplace">
          <Store size={16} strokeWidth={1.8} />
          Open Marketplace
        </a>
      </article>
    );
  }

  return (
    <div className="workflow-grid">
      {workflows.map((workflow) => (
        <article className="workflow-card" key={workflow.id}>
          <div className="workflow-card__header">
            <div>
              <span className="workspace-status-card__eyebrow">{workflow.category}</span>
              <h2>{workflow.title}</h2>
            </div>
            <span className="project-status project-status--ready">saved</span>
          </div>
          <p>{workflow.description}</p>
          <ol className="workflow-card__steps">
            {workflow.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="workflow-card__actions">
            <button className="btn-ghost danger-button" onClick={() => removeWorkflow(workflow.id)} type="button">
              <Trash2 size={16} strokeWidth={1.8} />
              Remove
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
