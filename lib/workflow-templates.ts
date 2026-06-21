import {
  PSLE_ENGLISH_TUTOR_PRICE_TOKENS,
  WORKFLOW_TOOL_PRICE_TOKENS
} from "@/lib/workflow-tool-allocations";

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
    category: "Clinical Operations",
    description: "Install the Gyne Agent Redis task pipeline with Kanban task publishing, OpenClaw workers, and optional Telegram updates.",
    id: "gyne-agent",
    itemType: "agent-app",
    priceTokens: WORKFLOW_TOOL_PRICE_TOKENS,
    repoUrl: "https://github.com/kenken64/gyne-agent",
    sourceLabel: "GitHub",
    steps: ["Open Kanban tasks", "Route work to Redis Streams", "Run OpenClaw worker responses"],
    title: "Gyne Agent"
  },
  {
    category: "Education",
    description: "Review PSLE English practice papers as page images, rendered markdown, visual snapshots, and snipped study notes.",
    id: "psle-eng-tutor-brain",
    itemType: "agent-app",
    priceTokens: PSLE_ENGLISH_TUTOR_PRICE_TOKENS,
    repoUrl: "https://github.com/kenken64/psle-eng-tutor-brain",
    sourceLabel: "GitHub",
    steps: ["Browse PSLE paper pages", "Review markdown beside images", "Snip visuals into study notes"],
    title: "PSLE English Tutor"
  }
];

export function workflowTemplateById(id: string) {
  return WORKFLOW_TEMPLATES.find((template) => template.id === id) ?? null;
}

export const MARKETPLACE_ITEMS = WORKFLOW_TEMPLATES;

export function marketplaceItemById(id: string) {
  return workflowTemplateById(id);
}
