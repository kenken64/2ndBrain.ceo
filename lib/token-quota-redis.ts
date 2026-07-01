import "server-only";

import { cleanEnvValue, getRedisUrlFrom, withRedis } from "@/lib/redis-connection";

const REDIS_URL_ENV_NAMES = ["TOKEN_QUOTA_REDIS_URL", "REDIS_URL"] as const;
const DEFAULT_TOKEN_QUOTA_REDIS_CHANNEL = "2ndbrain:token-quota";

export type TokenQuotaEventReason =
  | "admin_credit_drain_from_user"
  | "admin_credit_drain_to_admin"
  | "admin_quota_update"
  | "bedrock_token_usage"
  | "marketplace_tool_purchase"
  | "marketplace_tool_refund"
  | "marketplace_tool_renewal"
  | "openclaw_tokens_paused"
  | "openclaw_tokens_resumed"
  | "project_token_usage"
  | "solana_credit_purchase"
  | "transfer_credit_in"
  | "transfer_credit_out";

export type TokenQuotaSnapshot = {
  email?: string | null;
  llmTokenQuota: number;
  llmTokenUsed: number;
  openclawInstance?: string | null;
  openclawTokensPaused?: boolean;
  openclawTokensPausedAt?: string | null;
  openclawTokensPauseReason?: string | null;
  openclawTokensResumedAt?: string | null;
  userId: string;
};

type TokenQuotaEventInput = TokenQuotaSnapshot & {
  actorEmail?: string | null;
  actorUserId?: string | null;
  deltaTokens?: number;
  metadata?: Record<string, unknown>;
  reason: TokenQuotaEventReason;
};

function getRedisChannel() {
  return cleanEnvValue(process.env.TOKEN_QUOTA_REDIS_CHANNEL) ?? DEFAULT_TOKEN_QUOTA_REDIS_CHANNEL;
}

async function publishRedis(channel: string, payload: string) {
  if (!getRedisUrlFrom(REDIS_URL_ENV_NAMES)) {
    return false;
  }

  const result = await withRedis(REDIS_URL_ENV_NAMES, async (command) => {
    await command(["PUBLISH", channel, payload]);

    return true;
  });

  return result ?? false;
}

export async function publishTokenQuotaUpdate(input: TokenQuotaEventInput) {
  const openclawInstance = input.openclawInstance?.trim() || null;
  const hasOpenClawPauseState = input.openclawTokensPaused !== undefined;
  const openclawTokensPaused = Boolean(input.openclawTokensPaused);
  const openclawTokensPausedAt = input.openclawTokensPausedAt ?? null;
  const openclawTokensPauseReason = input.openclawTokensPauseReason ?? null;
  const openclawTokensResumedAt = input.openclawTokensResumedAt ?? null;
  const payload = {
    actor: {
      email: input.actorEmail ?? null,
      userId: input.actorUserId ?? null
    },
    availableTokens: Math.max(0, input.llmTokenQuota - input.llmTokenUsed),
    deltaTokens: input.deltaTokens ?? null,
    email: input.email ?? null,
    event: "token_quota.updated",
    llmTokenQuota: input.llmTokenQuota,
    llmTokenUsed: input.llmTokenUsed,
    metadata: input.metadata ?? {},
    openclawInstance,
    openclaw_instance: openclawInstance,
    ...(hasOpenClawPauseState
      ? {
          openclawTokensPaused,
          openclawTokensPausedAt,
          openclawTokensPauseReason,
          openclawTokensResumedAt,
          openclaw_tokens_paused: openclawTokensPaused,
          openclaw_tokens_paused_at: openclawTokensPausedAt,
          openclaw_tokens_pause_reason: openclawTokensPauseReason,
          openclaw_tokens_resumed_at: openclawTokensResumedAt
        }
      : {}),
    occurredAt: new Date().toISOString(),
    reason: input.reason,
    source: "2ndBrain.ceo",
    userId: input.userId,
    version: 1
  };

  try {
    return await publishRedis(getRedisChannel(), JSON.stringify(payload));
  } catch (error) {
    console.error("[token-quota-redis] publish failed", error);

    return false;
  }
}
