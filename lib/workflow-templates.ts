import {
  PSLE_ENGLISH_TUTOR_PRICE_TOKENS,
  WORKFLOW_TOOL_PRICE_TOKENS
} from "@/lib/workflow-tool-allocations";

export type WorkflowTemplate = {
  category: string;
  description: string;
  id: string;
  itemType: "agent-app" | "workflow";
  internalPath?: string;
  launchLabel?: string;
  repoUrl?: string;
  sourceLabel?: string;
  steps: string[];
  title: string;
  priceTokens: number;
};

export const WORKFLOW_STORAGE_KEY = "2ndbrain.workflowTemplates";

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    category: "Education",
    description: "Learn 2D game development through 21 guided modules with playable demos, AI-assisted asset creation, and a final Godot game.",
    id: "2d-game-dev-tutorial",
    itemType: "agent-app",
    launchLabel: "Launch",
    priceTokens: WORKFLOW_TOOL_PRICE_TOKENS,
    repoUrl: "https://github.com/kenken64/aicuber-2d-game-dev-tutorial",
    sourceLabel: "GitHub",
    steps: ["Create characters and game assets", "Practice gameplay systems", "Build your final Godot game"],
    title: "2D Game Development Tutorial"
  },
  {
    category: "Clinical Operations",
    description: "Install the Gyne Agent Redis task pipeline with Kanban task publishing, AI Agent workers, and optional Telegram updates.",
    id: "gyne-agent",
    itemType: "agent-app",
    launchLabel: "Launch",
    priceTokens: WORKFLOW_TOOL_PRICE_TOKENS,
    repoUrl: "https://github.com/kenken64/gyne-agent",
    sourceLabel: "GitHub",
    steps: ["Open Kanban tasks", "Route work to Redis Streams", "Run AI Agent worker responses"],
    title: "Gyne Agent"
  },
  {
    category: "Education",
    description: "Review PSLE English practice papers as page images, rendered markdown, visual snapshots, and snipped study notes.",
    id: "psle-eng-tutor-brain",
    itemType: "agent-app",
    launchLabel: "Launch",
    priceTokens: PSLE_ENGLISH_TUTOR_PRICE_TOKENS,
    repoUrl: "https://github.com/kenken64/psle-eng-tutor-brain",
    sourceLabel: "GitHub",
    steps: ["Browse PSLE paper pages", "Review markdown beside images", "Snip visuals into study notes"],
    title: "PSLE English Tutor"
  },
  {
    category: "Media Intelligence",
    description: "Passkey-secured news monitoring workspace with first-run agent setup, messaging-channel pairing, and category-driven dashboards.",
    id: "news-intelligence-desk",
    itemType: "agent-app",
    launchLabel: "Launch",
    priceTokens: WORKFLOW_TOOL_PRICE_TOKENS,
    repoUrl: "https://github.com/kenken64/newsclaw",
    sourceLabel: "GitHub",
    steps: ["Create passkey access", "Restore news workspace", "Track selected categories"],
    title: "News Intelligence Desk"
  },
  {
    category: "Productivity",
    description: "Review meeting transcripts and source documents, connect Zoom recordings, and track follow-ups in a private workspace.",
    id: "meeting-minutes",
    itemType: "agent-app",
    launchLabel: "Launch",
    priceTokens: WORKFLOW_TOOL_PRICE_TOKENS,
    repoUrl: "https://github.com/kenken64/aicuber-meeting-minutes",
    sourceLabel: "GitHub",
    steps: ["Connect your Zoom account", "Review transcripts and evidence", "Track and export follow-ups"],
    title: "Meeting Minutes"
  },
  {
    category: "Device Automation",
    description: "Browser-based Android screen mirroring, touch control, AI-guided task execution, and playback review for mobile workflows.",
    id: "mobile-device-operator",
    itemType: "agent-app",
    launchLabel: "Launch",
    priceTokens: WORKFLOW_TOOL_PRICE_TOKENS,
    repoUrl: "https://github.com/kenken64/mobiClaw",
    sourceLabel: "GitHub",
    steps: ["Mirror Android screens", "Run natural-language tasks", "Replay recorded workflows"],
    title: "Mobile Device Operator"
  },
  {
    category: "Productivity",
    description: "Stay focused with a simple Pomodoro timer for work sessions and breaks, built into your workspace.",
    id: "pomodoro-timer",
    itemType: "agent-app",
    internalPath: "/dashboard/pomodoro",
    launchLabel: "Open timer",
    priceTokens: 0,
    steps: ["Focus for 25 minutes", "Take short or long breaks", "Track completed focus sessions"],
    title: "Pomodoro Timer"
  }
];

export function workflowTemplateById(id: string) {
  return WORKFLOW_TEMPLATES.find((template) => template.id === id) ?? null;
}

export const MARKETPLACE_ITEMS = WORKFLOW_TEMPLATES;

export function marketplaceItemById(id: string) {
  return workflowTemplateById(id);
}
