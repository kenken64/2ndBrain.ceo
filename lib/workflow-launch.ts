import "server-only";

export type WorkflowLaunchConfig = {
  appUrlEnv: string;
  queryParams?: Array<{
    env: string;
    name: string;
  }>;
  secretEnv: string;
  toolId: string;
};

const WORKFLOW_LAUNCH_CONFIGS: Record<string, WorkflowLaunchConfig> = {
  "gyne-agent": {
    appUrlEnv: "GYNE_AGENT_URL",
    queryParams: [
      {
        env: "GYNE_AGENT_WS_URL",
        name: "publisher_ws_url"
      }
    ],
    secretEnv: "GYNE_AGENT_SESSION_SECRET",
    toolId: "gyne-agent"
  },
  "psle-eng-tutor-brain": {
    appUrlEnv: "PSLE_ENG_TUTOR_URL",
    secretEnv: "PSLE_ENG_TUTOR_SESSION_SECRET",
    toolId: "psle-eng-tutor-brain"
  }
};

export function workflowLaunchConfigById(itemId: string) {
  return WORKFLOW_LAUNCH_CONFIGS[itemId] ?? null;
}
