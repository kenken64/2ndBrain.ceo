const net = require("node:net");
const tls = require("node:tls");
const { createClient } = require("@supabase/supabase-js");

const DEFAULT_TOKEN_USAGE_CHANNEL = "openclaw:token_usage:v1";
const DEFAULT_TOKEN_QUOTA_CHANNEL = "2ndbrain:token-quota";
const DEFAULT_RECONNECT_MS = 5000;
const REDIS_CONNECT_TIMEOUT_MS = 5000;
const PROFILE_SELECT = "id,email,llm_token_quota,llm_token_used,openclaw_instance";
const MAX_UPDATE_ATTEMPTS = 3;
const RECENT_EVENT_TTL_MS = 15 * 60 * 1000;

class RedisErrorResponse extends Error {}

function cleanEnv(value) {
  return value?.trim().replace(/^['"]|['"]$/g, "") || null;
}

function firstEnv(names) {
  for (const name of names) {
    const value = cleanEnv(process.env[name]);

    if (value) {
      return value;
    }
  }

  return null;
}

function enabledByEnv(name, fallback = true) {
  const value = cleanEnv(process.env[name]);

  if (!value) {
    return fallback;
  }

  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function positiveNumberEnv(name, fallback) {
  const value = Number(cleanEnv(process.env[name]) ?? "");

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function usageRedisUrl() {
  return firstEnv(["TOKEN_USAGE_REDIS_URL", "TOKEN_QUOTA_REDIS_URL", "REDIS_URL"]);
}

function quotaRedisUrl() {
  return firstEnv(["TOKEN_QUOTA_REDIS_URL", "TOKEN_USAGE_REDIS_URL", "REDIS_URL"]);
}

function usageChannel() {
  return cleanEnv(process.env.TOKEN_USAGE_REDIS_CHANNEL) || DEFAULT_TOKEN_USAGE_CHANNEL;
}

function quotaChannel() {
  return cleanEnv(process.env.TOKEN_QUOTA_REDIS_CHANNEL) || DEFAULT_TOKEN_QUOTA_CHANNEL;
}

function supabaseUrl() {
  return firstEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]);
}

function supabaseServiceRoleKey() {
  return firstEnv(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY", "SERVICE_ROLE_KEY"]);
}

function createSupabaseAdminClient() {
  const url = supabaseUrl();
  const serviceRoleKey = supabaseServiceRoleKey();

  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

function encodeRedisCommand(args) {
  return `*${args.length}\r\n${args
    .map((arg) => {
      const value = String(arg);
      const byteLength = Buffer.byteLength(value);

      return `$${byteLength}\r\n${value}\r\n`;
    })
    .join("")}`;
}

function parseLine(buffer, offset) {
  const end = buffer.indexOf("\r\n", offset);

  if (end === -1) {
    return null;
  }

  return {
    line: buffer.toString("utf8", offset, end),
    nextOffset: end + 2
  };
}

function parseRedisValue(buffer, offset = 0) {
  if (offset >= buffer.length) {
    return null;
  }

  const prefix = String.fromCharCode(buffer[offset]);
  const line = parseLine(buffer, offset + 1);

  if (!line) {
    return null;
  }

  if (prefix === "+") {
    return {
      nextOffset: line.nextOffset,
      value: line.line
    };
  }

  if (prefix === "-") {
    return {
      nextOffset: line.nextOffset,
      value: new RedisErrorResponse(line.line || "redis_error")
    };
  }

  if (prefix === ":") {
    return {
      nextOffset: line.nextOffset,
      value: Number(line.line)
    };
  }

  if (prefix === "$") {
    const length = Number(line.line);

    if (length === -1) {
      return {
        nextOffset: line.nextOffset,
        value: null
      };
    }

    const end = line.nextOffset + length;

    if (buffer.length < end + 2) {
      return null;
    }

    return {
      nextOffset: end + 2,
      value: buffer.toString("utf8", line.nextOffset, end)
    };
  }

  if (prefix === "*") {
    const length = Number(line.line);

    if (length === -1) {
      return {
        nextOffset: line.nextOffset,
        value: null
      };
    }

    const values = [];
    let nextOffset = line.nextOffset;

    for (let index = 0; index < length; index += 1) {
      const parsed = parseRedisValue(buffer, nextOffset);

      if (!parsed) {
        return null;
      }

      values.push(parsed.value);
      nextOffset = parsed.nextOffset;
    }

    return {
      nextOffset,
      value: values
    };
  }

  throw new Error(`Unsupported Redis response prefix: ${prefix}`);
}

function connectSocket(parsedUrl) {
  const useTls = parsedUrl.protocol === "rediss:";
  const port = parsedUrl.port ? Number(parsedUrl.port) : useTls ? 6380 : 6379;
  const host = parsedUrl.hostname;
  const socket = useTls ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });

  socket.setNoDelay(true);

  return socket;
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const connectEvent = socket.encrypted ? "secureConnect" : "connect";
    const timeout = setTimeout(() => {
      settle(reject, new Error("Redis connection timed out."));
      socket.destroy();
    }, REDIS_CONNECT_TIMEOUT_MS);

    function settle(callback, value) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      socket.off("connect", onConnect);
      socket.off("secureConnect", onConnect);
      socket.off("error", onError);
      callback(value);
    }

    function onConnect() {
      settle(resolve);
    }

    function onError(error) {
      settle(reject, error);
    }

    socket.once(connectEvent, onConnect);
    socket.once("error", onError);
  });
}

async function requestRedis(parsedUrl, args) {
  const socket = connectSocket(parsedUrl);
  let buffer = Buffer.alloc(0);

  try {
    await waitForConnect(socket);

    const username = decodeURIComponent(parsedUrl.username || "");
    const password = decodeURIComponent(parsedUrl.password || "");

    if (password) {
      await requestOnSocket(socket, buffer, username ? ["AUTH", username, password] : ["AUTH", password]);
      buffer = Buffer.alloc(0);
    }

    return await requestOnSocket(socket, buffer, args);
  } finally {
    socket.end();
  }
}

function requestOnSocket(socket, initialBuffer, args) {
  let buffer = initialBuffer;

  return new Promise((resolve, reject) => {
    function cleanup() {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    }

    function readResponse() {
      let parsed;

      try {
        parsed = parseRedisValue(buffer);
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }

      if (!parsed) {
        return;
      }

      cleanup();

      if (parsed.value instanceof RedisErrorResponse) {
        reject(parsed.value);
      } else {
        resolve(parsed.value);
      }
    }

    function onData(chunk) {
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      readResponse();
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    function onClose() {
      cleanup();
      reject(new Error("Redis connection closed before a response was received."));
    }

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
    socket.write(encodeRedisCommand(args));
    readResponse();
  });
}

async function publishRedis(url, channel, payload) {
  if (!url) {
    return false;
  }

  await requestRedis(new URL(url), ["PUBLISH", channel, payload]);
  return true;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() || null : null;
}

function cleanEmail(value) {
  return cleanString(value)?.toLowerCase() ?? null;
}

function safeInteger(value) {
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : null;
  }

  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : null;
  }

  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const number = Number(value);

    return Number.isSafeInteger(number) ? number : null;
  }

  return null;
}

function positiveIntegerFrom(values) {
  for (const value of values) {
    const number = safeInteger(value);

    if (number !== null && number > 0) {
      return number;
    }
  }

  return null;
}

function normalizeUsageEvent(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (payload.type && payload.type !== "openclaw.token_usage.v1") {
    return null;
  }

  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage : {};
  const inputTokens = safeInteger(payload.input_tokens ?? payload.inputTokens ?? usage.input_tokens ?? usage.inputTokens);
  const outputTokens = safeInteger(payload.output_tokens ?? payload.outputTokens ?? usage.output_tokens ?? usage.outputTokens);
  const summedTokens =
    inputTokens !== null && outputTokens !== null && inputTokens + outputTokens > 0 ? inputTokens + outputTokens : null;
  const deltaTokens = positiveIntegerFrom([
    payload.llm_token_used_delta,
    payload.llmTokenUsedDelta,
    payload.delta_tokens,
    payload.deltaTokens,
    payload.total_tokens,
    payload.totalTokens,
    usage.total_tokens,
    usage.totalTokens,
    summedTokens
  ]);

  if (deltaTokens === null) {
    return null;
  }

  return {
    deltaTokens,
    email: cleanEmail(payload.email ?? payload.user_email ?? payload.userEmail ?? usage.email),
    endpoint: cleanString(payload.endpoint ?? usage.endpoint),
    eventId: cleanString(payload.event_id ?? payload.eventId ?? payload.id),
    model: cleanString(payload.model ?? usage.model),
    openclawInstance: cleanString(
      payload.openclaw_instance ?? payload.openclawInstance ?? payload.instance ?? usage.openclaw_instance
    ),
    profileId: cleanString(payload.profile_id ?? payload.profileId ?? payload.user_id ?? payload.userId),
    provider: cleanString(payload.provider ?? usage.provider),
    requestId: cleanString(payload.request_id ?? payload.requestId ?? usage.request_id)
  };
}

async function selectOneProfile(query, label) {
  const { data, error } = await query.limit(2);

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    return null;
  }

  if (data.length > 1) {
    throw new Error(`multiple_profiles_matched_${label}`);
  }

  return data[0];
}

async function findProfileForUsage(supabase, event) {
  if (event.openclawInstance) {
    const profile = await selectOneProfile(
      supabase.from("profiles").select(PROFILE_SELECT).eq("openclaw_instance", event.openclawInstance),
      "openclaw_instance"
    );

    if (profile) {
      return {
        match: "openclaw_instance",
        profile
      };
    }
  }

  if (event.profileId) {
    const profile = await selectOneProfile(
      supabase.from("profiles").select(PROFILE_SELECT).eq("id", event.profileId),
      "profile_id"
    );

    if (profile) {
      return {
        match: "profile_id",
        profile
      };
    }
  }

  if (event.email) {
    const profile = await selectOneProfile(
      supabase.from("profiles").select(PROFILE_SELECT).ilike("email", event.email),
      "email"
    );

    if (profile) {
      return {
        match: "email",
        profile
      };
    }
  }

  return null;
}

async function isAdminProfile(supabase, profile) {
  const normalizedEmail = cleanEmail(profile.email);
  const normalizedUserId = cleanString(profile.id);

  if (!normalizedEmail && !normalizedUserId) {
    return false;
  }

  let query = supabase
    .from("admin_users")
    .select("id")
    .eq("enabled", true);

  if (normalizedEmail && normalizedUserId) {
    query = query.or(`email.eq.${normalizedEmail},user_id.eq.${normalizedUserId}`);
  } else if (normalizedEmail) {
    query = query.eq("email", normalizedEmail);
  } else {
    query = query.eq("user_id", normalizedUserId);
  }

  const { data, error } = await query.limit(1);

  if (error) {
    console.warn(
      "[token-usage-listener] admin lookup failed",
      JSON.stringify({
        error: error.message,
        userId: normalizedUserId
      })
    );
    return false;
  }

  return Boolean(data?.length);
}

async function incrementUsage(supabase, profileId, deltaTokens) {
  for (let attempt = 1; attempt <= MAX_UPDATE_ATTEMPTS; attempt += 1) {
    const { data: currentRows, error: currentError } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("id", profileId)
      .limit(1);

    if (currentError) {
      throw currentError;
    }

    const current = currentRows?.[0];

    if (!current) {
      throw new Error("usage_profile_not_found");
    }

    const currentUsed = safeInteger(current.llm_token_used) ?? 0;
    const nextUsed = currentUsed + deltaTokens;

    if (!Number.isSafeInteger(nextUsed)) {
      throw new Error("usage_total_exceeds_safe_integer");
    }

    const { data: updatedRows, error: updateError } = await supabase
      .from("profiles")
      .update({ llm_token_used: nextUsed })
      .eq("id", profileId)
      .eq("llm_token_used", currentUsed)
      .select(PROFILE_SELECT)
      .limit(1);

    if (updateError) {
      throw updateError;
    }

    if (updatedRows?.[0]) {
      return updatedRows[0];
    }
  }

  throw new Error("usage_update_conflict");
}

async function publishQuotaSnapshot(profile, usageEvent, redisUrl, channel) {
  const llmTokenQuota = safeInteger(profile.llm_token_quota) ?? 0;
  const llmTokenUsed = safeInteger(profile.llm_token_used) ?? 0;
  const openclawInstance = cleanString(profile.openclaw_instance) ?? usageEvent.openclawInstance;
  const payload = {
    actor: {
      email: null,
      userId: null
    },
    availableTokens: Math.max(0, llmTokenQuota - llmTokenUsed),
    deltaTokens: -usageEvent.deltaTokens,
    email: profile.email ?? usageEvent.email ?? null,
    event: "token_quota.updated",
    llmTokenQuota,
    llmTokenUsed,
    metadata: {
      endpoint: usageEvent.endpoint,
      model: usageEvent.model,
      provider: usageEvent.provider,
      requestId: usageEvent.requestId,
      usageEventId: usageEvent.eventId
    },
    openclawInstance,
    openclaw_instance: openclawInstance,
    occurredAt: new Date().toISOString(),
    reason: "bedrock_token_usage",
    source: "2ndBrain.ceo",
    userId: profile.id,
    version: 1
  };

  await publishRedis(redisUrl, channel, JSON.stringify(payload));
}

function pruneRecentEvents(recentEventIds, now = Date.now()) {
  for (const [eventId, timestamp] of recentEventIds) {
    if (now - timestamp > RECENT_EVENT_TTL_MS) {
      recentEventIds.delete(eventId);
    }
  }
}

function rememberEvent(recentEventIds, eventId) {
  if (!eventId) {
    return false;
  }

  const now = Date.now();
  pruneRecentEvents(recentEventIds, now);

  if (recentEventIds.has(eventId)) {
    return true;
  }

  recentEventIds.set(eventId, now);
  return false;
}

async function applyUsageEvent({ channel, quotaRedisChannel, quotaRedisUrlValue, recentEventIds, supabase }, payload) {
  const usageEvent = normalizeUsageEvent(payload);

  if (!usageEvent) {
    return;
  }

  if (rememberEvent(recentEventIds, usageEvent.eventId)) {
    console.info("[token-usage-listener] duplicate event ignored", JSON.stringify({ eventId: usageEvent.eventId }));
    return;
  }

  const matched = await findProfileForUsage(supabase, usageEvent);

  if (!matched) {
    console.warn(
      "[token-usage-listener] usage event did not match a profile",
      JSON.stringify({
        channel,
        hasEmail: Boolean(usageEvent.email),
        hasProfileId: Boolean(usageEvent.profileId),
        openclawInstance: usageEvent.openclawInstance
      })
    );
    return;
  }

  if (await isAdminProfile(supabase, matched.profile)) {
    console.info(
      "[token-usage-listener] admin usage ignored",
      JSON.stringify({
        deltaTokens: usageEvent.deltaTokens,
        match: matched.match,
        openclawInstance: usageEvent.openclawInstance,
        userId: matched.profile.id
      })
    );
    return;
  }

  const updatedProfile = await incrementUsage(supabase, matched.profile.id, usageEvent.deltaTokens);

  try {
    await publishQuotaSnapshot(updatedProfile, usageEvent, quotaRedisUrlValue, quotaRedisChannel);
  } catch (error) {
    console.error("[token-usage-listener] quota snapshot publish failed", error);
  }

  console.info(
    "[token-usage-listener] usage applied",
    JSON.stringify({
      deltaTokens: usageEvent.deltaTokens,
      match: matched.match,
      openclawInstance: usageEvent.openclawInstance,
      userId: updatedProfile.id
    })
  );
}

function createUsageSubscriber(config) {
  let stopped = false;
  let socket = null;
  let reconnectTimer = null;
  let queue = Promise.resolve();

  function scheduleReconnect(reason) {
    if (stopped) {
      return;
    }

    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      connect().catch((error) => {
        console.error("[token-usage-listener] reconnect failed", error);
        scheduleReconnect("reconnect_failed");
      });
    }, config.reconnectMs);

    console.warn(
      "[token-usage-listener] reconnect scheduled",
      JSON.stringify({ reason, reconnectMs: config.reconnectMs })
    );
  }

  function handleRedisValue(value) {
    if (value instanceof RedisErrorResponse) {
      throw value;
    }

    if (!Array.isArray(value)) {
      return;
    }

    const type = typeof value[0] === "string" ? value[0].toLowerCase() : "";

    if (type === "subscribe") {
      console.info("[token-usage-listener] subscribed", JSON.stringify({ channel: value[1] }));
      return;
    }

    if (type !== "message" || value[1] !== config.channel || typeof value[2] !== "string") {
      return;
    }

    queue = queue
      .then(async () => {
        let payload;

        try {
          payload = JSON.parse(value[2]);
        } catch {
          console.warn("[token-usage-listener] invalid JSON message ignored", JSON.stringify({ channel: config.channel }));
          return;
        }

        await applyUsageEvent(config, payload);
      })
      .catch((error) => {
        console.error("[token-usage-listener] usage message failed", error);
      });
  }

  async function connect() {
    const parsedUrl = new URL(config.redisUrl);
    const nextSocket = connectSocket(parsedUrl);
    let buffer = Buffer.alloc(0);

    socket?.destroy();
    socket = nextSocket;

    nextSocket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);

      while (buffer.length > 0) {
        let parsed;

        try {
          parsed = parseRedisValue(buffer);
        } catch (error) {
          console.error("[token-usage-listener] Redis parse failed", error);
          nextSocket.destroy();
          return;
        }

        if (!parsed) {
          return;
        }

        buffer = buffer.subarray(parsed.nextOffset);

        try {
          handleRedisValue(parsed.value);
        } catch (error) {
          console.error("[token-usage-listener] Redis message failed", error);
          nextSocket.destroy();
          return;
        }
      }
    });

    nextSocket.on("error", (error) => {
      console.error("[token-usage-listener] Redis connection error", error.message);
    });

    nextSocket.on("close", () => {
      if (socket === nextSocket) {
        socket = null;
      }

      scheduleReconnect("connection_closed");
    });

    await waitForConnect(nextSocket);

    const username = decodeURIComponent(parsedUrl.username || "");
    const password = decodeURIComponent(parsedUrl.password || "");

    if (password) {
      nextSocket.write(encodeRedisCommand(username ? ["AUTH", username, password] : ["AUTH", password]));
    }

    nextSocket.write(encodeRedisCommand(["SUBSCRIBE", config.channel]));
  }

  return {
    start() {
      connect().catch((error) => {
        console.error("[token-usage-listener] initial connection failed", error.message);
        scheduleReconnect("initial_connection_failed");
      });
    },
    stop() {
      stopped = true;
      clearTimeout(reconnectTimer);
      socket?.destroy();
      socket = null;
    }
  };
}

function startTokenUsageListener() {
  if (!enabledByEnv("TOKEN_USAGE_CONSUMER_ENABLED", true)) {
    console.info("[token-usage-listener] disabled by TOKEN_USAGE_CONSUMER_ENABLED");
    return () => {};
  }

  const redisUrlValue = usageRedisUrl();

  if (!redisUrlValue) {
    console.info("[token-usage-listener] Redis URL not configured; usage events will not be consumed");
    return () => {};
  }

  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    console.warn("[token-usage-listener] Supabase service role is not configured; usage events will not be consumed");
    return () => {};
  }

  const subscriber = createUsageSubscriber({
    channel: usageChannel(),
    quotaRedisChannel: quotaChannel(),
    quotaRedisUrlValue: quotaRedisUrl(),
    recentEventIds: new Map(),
    reconnectMs: positiveNumberEnv("TOKEN_USAGE_CONSUMER_RECONNECT_MS", DEFAULT_RECONNECT_MS),
    redisUrl: redisUrlValue,
    supabase
  });

  subscriber.start();
  return () => subscriber.stop();
}

module.exports = {
  startTokenUsageListener
};
