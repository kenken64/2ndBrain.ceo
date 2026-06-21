import { WORKFLOW_TOOL_PRICE_TOKENS } from "@/lib/workflow-tool-allocations";

export type WorkflowTemplate = {
  category: string;
  description: string;
  id: string;
  itemType: "agent-app" | "workflow";
  repoUrl?: string;
  sourceLabel?: string;
  steps: string[];
  title: string;
  priceTokens: number;
};

export const WORKFLOW_STORAGE_KEY = "2ndbrain.workflowTemplates";

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    category: "Knowledge",
    description: "Collect source files, generate a Nth Brain brief, and prepare graph indexing.",
    id: "nth-brain-intake",
    itemType: "workflow",
    priceTokens: WORKFLOW_TOOL_PRICE_TOKENS,
    steps: ["Collect files", "Generate brief", "Queue graph sync"],
    title: "Nth Brain Intake"
  },
  {
    category: "Operations",
    description: "Draft a daily owner brief from workspace status, open projects, and pending follow-ups.",
    id: "daily-owner-brief",
    itemType: "workflow",
    priceTokens: WORKFLOW_TOOL_PRICE_TOKENS,
    steps: ["Read workspace state", "Summarize active work", "Draft owner brief"],
    title: "Daily Owner Brief"
  },
  {
    category: "Approvals",
    description: "Prepare a Telegram approval request with context, risk notes, and next action.",
    id: "telegram-approval-pack",
    itemType: "workflow",
    priceTokens: WORKFLOW_TOOL_PRICE_TOKENS,
    steps: ["Collect context", "Write approval copy", "Send action packet"],
    title: "Telegram Approval Pack"
  },
  {
    category: "Clinical Operations",
    description: "Install the Gyne Agent Redis task pipeline with Kanban task publishing, OpenClaw workers, and optional Telegram updates.",
    id: "gyne-agent",
    itemType: "agent-app",
    priceTokens: WORKFLOW_TOOL_PRICE_TOKENS,
    repoUrl: "https://github.com/kenken64/gyne-agent",
    sourceLabel: "GitHub",
    steps: ["Open Kanban tasks", "Route work to Redis Streams", "Run OpenClaw worker responses"],
    title: "Gyne Agent"
  }
];

export function workflowTemplateById(id: string) {
  return WORKFLOW_TEMPLATES.find((template) => template.id === id) ?? null;
}

export const MARKETPLACE_ITEMS = WORKFLOW_TEMPLATES;

export function marketplaceItemById(id: string) {
  return workflowTemplateById(id);
}
