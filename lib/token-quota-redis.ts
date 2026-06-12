import "server-only";

import net from "node:net";
import tls from "node:tls";

const REDIS_URL_ENV_NAMES = ["TOKEN_QUOTA_REDIS_URL", "REDIS_URL"] as const;
const DEFAULT_TOKEN_QUOTA_REDIS_CHANNEL = "2ndbrain:token-quota";
const REDIS_CONNECT_TIMEOUT_MS = 5000;

export type TokenQuotaEventReason =
  | "admin_credit_drain_from_user"
  | "admin_credit_drain_to_admin"
  | "admin_quota_update"
  | "project_token_usage"
  | "solana_credit_purchase"
  | "transfer_credit_in"
  | "transfer_credit_out";

export type TokenQuotaSnapshot = {
  email?: string | null;
  llmTokenQuota: number;
  llmTokenUsed: number;
  userId: string;
};

type TokenQuotaEventInput = TokenQuotaSnapshot & {
  actorEmail?: string | null;
  actorUserId?: string | null;
  deltaTokens?: number;
  metadata?: Record<string, unknown>;
  reason: TokenQuotaEventReason;
};

type RedisResponse = number | string | null;

function cleanEnvValue(value: string | undefined) {
  const cleaned = value?.trim().replace(/^['"]|['"]$/g, "");
  return cleaned || null;
}

function getRedisUrl() {
  for (const name of REDIS_URL_ENV_NAMES) {
    const value = cleanEnvValue(process.env[name]);

    if (value) {
      return value;
    }
  }

  return null;
}

function getRedisChannel() {
  return cleanEnvValue(process.env.TOKEN_QUOTA_REDIS_CHANNEL) ?? DEFAULT_TOKEN_QUOTA_REDIS_CHANNEL;
}

function encodeRedisCommand(args: string[]) {
  return `*${args.length}\r\n${args
    .map((arg) => {
      const byteLength = Buffer.byteLength(arg);

      return `$${byteLength}\r\n${arg}\r\n`;
    })
    .join("")}`;
}

function parseLine(buffer: Buffer<ArrayBufferLike>, offset: number) {
  const end = buffer.indexOf("\r\n", offset);

  if (end === -1) {
    return null;
  }

  return {
    line: buffer.toString("utf8", offset, end),
    nextOffset: end + 2
  };
}

function parseRedisResponse(buffer: Buffer<ArrayBufferLike>): { rest: Buffer<ArrayBufferLike>; value: RedisResponse } | null {
  if (buffer.length === 0) {
    return null;
  }

  const prefix = String.fromCharCode(buffer[0]);
  const line = parseLine(buffer, 1);

  if (!line) {
    return null;
  }

  if (prefix === "+") {
    return {
      rest: buffer.subarray(line.nextOffset),
      value: line.line
    };
  }

  if (prefix === "-") {
    throw new Error(line.line || "redis_error");
  }

  if (prefix === ":") {
    return {
      rest: buffer.subarray(line.nextOffset),
      value: Number(line.line)
    };
  }

  if (prefix === "$") {
    const length = Number(line.line);

    if (length === -1) {
      return {
        rest: buffer.subarray(line.nextOffset),
        value: null
      };
    }

    const end = line.nextOffset + length;

    if (buffer.length < end + 2) {
      return null;
    }

    return {
      rest: buffer.subarray(end + 2),
      value: buffer.toString("utf8", line.nextOffset, end)
    };
  }

  throw new Error(`Unsupported Redis response prefix: ${prefix}`);
}

async function connectRedis(redisUrl: URL) {
  const useTls = redisUrl.protocol === "rediss:";
  const port = redisUrl.port ? Number(redisUrl.port) : useTls ? 6380 : 6379;
  const host = redisUrl.hostname;
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let pending:
    | {
        reject: (error: Error) => void;
        resolve: (value: RedisResponse) => void;
      }
    | null = null;

  const socket = useTls
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });

  socket.setNoDelay(true);

  function flushPending() {
    if (!pending) {
      return;
    }

    try {
      const parsed = parseRedisResponse(buffer);

      if (!parsed) {
        return;
      }

      const current = pending;
      pending = null;
      buffer = parsed.rest;
      current.resolve(parsed.value);
    } catch (error) {
      const current = pending;
      pending = null;
      current?.reject(error instanceof Error ? error : new Error("redis_parse_error"));
    }
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.destroy(new Error("redis_connect_timeout"));
      reject(new Error("Redis connection timed out."));
    }, REDIS_CONNECT_TIMEOUT_MS);

    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("secureConnect", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  socket.on("data", (chunk) => {
    const chunkBuffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;

    buffer = Buffer.concat([buffer, chunkBuffer]);
    flushPending();
  });

  socket.on("error", (error) => {
    if (pending) {
      pending.reject(error);
      pending = null;
    }
  });

  async function command(args: string[]) {
    if (pending) {
      throw new Error("redis_command_in_progress");
    }

    const response = new Promise<RedisResponse>((resolve, reject) => {
      pending = { reject, resolve };
    });

    socket.write(encodeRedisCommand(args));
    flushPending();

    return response;
  }

  async function close() {
    try {
      await command(["QUIT"]);
    } catch {
      // The connection is going away anyway.
    } finally {
      socket.end();
    }
  }

  return {
    close,
    command
  };
}

async function publishRedis(channel: string, payload: string) {
  const redisUrl = getRedisUrl();

  if (!redisUrl) {
    return false;
  }

  const parsedUrl = new URL(redisUrl);
  const client = await connectRedis(parsedUrl);

  try {
    const username = decodeURIComponent(parsedUrl.username || "");
    const password = decodeURIComponent(parsedUrl.password || "");

    if (password) {
      await client.command(username ? ["AUTH", username, password] : ["AUTH", password]);
    }

    await client.command(["PUBLISH", channel, payload]);

    return true;
  } finally {
    await client.close();
  }
}

export async function publishTokenQuotaUpdate(input: TokenQuotaEventInput) {
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
