import "server-only";

export type WorkflowLaunchConfig = {
  appUrlEnv: string;
  itemId: string;
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
    itemId: "gyne-agent",
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
    itemId: "psle-eng-tutor-brain",
    secretEnv: "PSLE_ENG_TUTOR_SESSION_SECRET",
    toolId: "psle-eng-tutor-brain"
  },
  "mobile-device-operator": {
    appUrlEnv: "MOBILE_DEVICE_OPERATOR_URL",
    itemId: "mobile-device-operator",
    secretEnv: "MOBILE_DEVICE_OPERATOR_SESSION_SECRET",
    toolId: "mobile-device-operator"
  }
};

export function workflowLaunchConfigById(itemId: string) {
  return WORKFLOW_LAUNCH_CONFIGS[itemId] ?? null;
}

export function workflowLaunchConfigByToolId(toolId: string) {
  return Object.values(WORKFLOW_LAUNCH_CONFIGS).find((config) => config.toolId === toolId) ?? null;
}
