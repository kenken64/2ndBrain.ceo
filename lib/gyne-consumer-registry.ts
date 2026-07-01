import "server-only";

import { cleanEnvValue, withRedis, type RedisResponse } from "@/lib/redis-connection";

// The publisher reads GYNE_REDIS_URL/REDIS_URL too; both sides must share the same Redis.
const GYNE_REDIS_URL_ENV_NAMES = ["GYNE_REDIS_URL", "REDIS_URL"] as const;
const DEFAULT_OWNER_KEY_PREFIX = "openclaw:owners";

function ownerKeyPrefix() {
  return cleanEnvValue(process.env.GYNE_OWNER_KEY_PREFIX) ?? DEFAULT_OWNER_KEY_PREFIX;
}

function ownerRegistryKey(userId: string) {
  return `${ownerKeyPrefix()}:${userId}`;
}

function toStringArray(value: RedisResponse): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Records that `consumerName` (the gyne CONSUMER_NAME of a provisioned OpenClaw instance) is owned by
 * `userId`, so the Gyne Agent publisher includes it when that user lists consumers. Idempotent.
 * Returns false when no Redis is configured (treated as a soft no-op by callers).
 */
export async function addConsumerOwner(userId: string, consumerName: string) {
  const trimmedUser = userId.trim();
  const trimmedConsumer = consumerName.trim();

  if (!trimmedUser || !trimmedConsumer) {
    return false;
  }

  const result = await withRedis(GYNE_REDIS_URL_ENV_NAMES, async (command) => {
    await command(["SADD", ownerRegistryKey(trimmedUser), trimmedConsumer]);

    return true;
  });

  return result ?? false;
}

/**
 * Removes the ownership mapping so a deprovisioned/stopped consumer disappears from the user's Gyne
 * Agent listing. Idempotent. Returns false when no Redis is configured.
 */
export async function removeConsumerOwner(userId: string, consumerName: string) {
  const trimmedUser = userId.trim();
  const trimmedConsumer = consumerName.trim();

  if (!trimmedUser || !trimmedConsumer) {
    return false;
  }

  const result = await withRedis(GYNE_REDIS_URL_ENV_NAMES, async (command) => {
    await command(["SREM", ownerRegistryKey(trimmedUser), trimmedConsumer]);

    return true;
  });

  return result ?? false;
}

/**
 * Re-asserts the full set of consumer names a user owns (e.g. on launch, to self-heal if the Redis
 * owner set was lost). Additive only — it does not remove names that are no longer owned; deprovision
 * handles removals via removeConsumerOwner. Returns false when no Redis is configured.
 */
export async function syncConsumerOwners(userId: string, consumerNames: string[]) {
  const trimmedUser = userId.trim();
  const members = Array.from(
    new Set(consumerNames.map((name) => name.trim()).filter((name) => name.length > 0))
  );

  if (!trimmedUser || members.length === 0) {
    return false;
  }

  const result = await withRedis(GYNE_REDIS_URL_ENV_NAMES, async (command) => {
    await command(["SADD", ownerRegistryKey(trimmedUser), ...members]);

    return true;
  });

  return result ?? false;
}

/**
 * Returns the consumer names currently mapped to `userId` in Redis. For reconcile/debug; returns an
 * empty array when no Redis is configured.
 */
export async function listConsumerOwners(userId: string) {
  const trimmedUser = userId.trim();

  if (!trimmedUser) {
    return [];
  }

  const result = await withRedis(GYNE_REDIS_URL_ENV_NAMES, async (command) => {
    const members = await command(["SMEMBERS", ownerRegistryKey(trimmedUser)]);

    return toStringArray(members);
  });

  return result ?? [];
}
