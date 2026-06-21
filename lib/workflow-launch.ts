import "server-only";

export type WorkflowLaunchConfig = {
  appUrlEnv: string;
  secretEnv: string;
  toolId: string;
};

const WORKFLOW_LAUNCH_CONFIGS: Record<string, WorkflowLaunchConfig> = {
  "psle-eng-tutor-brain": {
    appUrlEnv: "PSLE_ENG_TUTOR_URL",
    secretEnv: "PSLE_ENG_TUTOR_SESSION_SECRET",
    toolId: "psle-eng-tutor-brain"
  }
};

export function workflowLaunchConfigById(itemId: string) {
  return WORKFLOW_LAUNCH_CONFIGS[itemId] ?? null;
}
