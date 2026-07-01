import "server-only";

import net from "node:net";
import tls from "node:tls";

const REDIS_CONNECT_TIMEOUT_MS = 5000;

export type RedisResponse = number | string | null | RedisResponse[];

export function cleanEnvValue(value: string | undefined) {
  const cleaned = value?.trim().replace(/^['"]|['"]$/g, "");
  return cleaned || null;
}

export function getRedisUrlFrom(envNames: readonly string[]) {
  for (const name of envNames) {
    const value = cleanEnvValue(process.env[name]);

    if (value) {
      return value;
    }
  }

  return null;
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

function parseRedisResponse(
  buffer: Buffer<ArrayBufferLike>
): { rest: Buffer<ArrayBufferLike>; value: RedisResponse } | null {
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

  if (prefix === "*") {
    const count = Number(line.line);

    if (count === -1) {
      return {
        rest: buffer.subarray(line.nextOffset),
        value: null
      };
    }

    const items: RedisResponse[] = [];
    let rest = buffer.subarray(line.nextOffset);

    for (let index = 0; index < count; index += 1) {
      const parsed = parseRedisResponse(rest);

      if (!parsed) {
        return null;
      }

      items.push(parsed.value);
      rest = parsed.rest;
    }

    return { rest, value: items };
  }

  throw new Error(`Unsupported Redis response prefix: ${prefix}`);
}

export async function connectRedis(redisUrl: URL) {
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

/**
 * Opens a Redis connection to the first configured URL in `envNames`, authenticates if the URL carries
 * credentials, runs `run` with a raw command sender, and always closes the connection. Returns `null`
 * when no Redis URL is configured (callers treat this as a no-op).
 */
export async function withRedis<T>(
  envNames: readonly string[],
  run: (command: (args: string[]) => Promise<RedisResponse>) => Promise<T>
): Promise<T | null> {
  const redisUrl = getRedisUrlFrom(envNames);

  if (!redisUrl) {
    return null;
  }

  const parsedUrl = new URL(redisUrl);
  const client = await connectRedis(parsedUrl);

  try {
    const username = decodeURIComponent(parsedUrl.username || "");
    const password = decodeURIComponent(parsedUrl.password || "");

    if (password) {
      await client.command(username ? ["AUTH", username, password] : ["AUTH", password]);
    }

    return await run(client.command);
  } finally {
    await client.close();
  }
}
