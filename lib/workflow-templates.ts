export type WorkflowTemplate = {
  category: string;
  description: string;
  id: string;
  steps: string[];
  title: string;
};

export const WORKFLOW_STORAGE_KEY = "2ndbrain.workflowTemplates";

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    category: "Knowledge",
    description: "Collect source files, generate a Nth Brain brief, and prepare graph indexing.",
    id: "nth-brain-intake",
    steps: ["Collect files", "Generate brief", "Queue graph sync"],
    title: "Nth Brain Intake"
  },
  {
    category: "Operations",
    description: "Draft a daily owner brief from workspace status, open projects, and pending follow-ups.",
    id: "daily-owner-brief",
    steps: ["Read workspace state", "Summarize active work", "Draft owner brief"],
    title: "Daily Owner Brief"
  },
  {
    category: "Approvals",
    description: "Prepare a Telegram approval request with context, risk notes, and next action.",
    id: "telegram-approval-pack",
    steps: ["Collect context", "Write approval copy", "Send action packet"],
    title: "Telegram Approval Pack"
  }
];

export function workflowTemplateById(id: string) {
  return WORKFLOW_TEMPLATES.find((template) => template.id === id) ?? null;
}
