import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { getRedisUrlFrom, withRedis } from "@/lib/redis-connection";
import { chatSoftLimit, requestRateLimit, type RateLimitPolicy } from "@/lib/rate-limit-policy";

const redisNames = ["RATE_LIMIT_REDIS_URL", "TOKEN_QUOTA_REDIS_URL", "REDIS_URL"] as const;
const buckets = new Map<string, { count: number; expiresAt: number }>();
const maxBuckets = 10_000;
let redisRetryAt = 0;
let warnedMissingIp = false;
const incrementScript = `local n = redis.call('INCR', KEYS[1]); local ttl = redis.call('PTTL', KEYS[1]); if n == 1 or ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]); end; return {n, ttl}`;

/** Trust only a configured ingress header, Railway's overwritten header, or our custom server's peer header. */
export function requestClientIp(request: Request): string {
  const configured = process.env.RATE_LIMIT_TRUSTED_IP_HEADER?.trim().toLowerCase();
  const railway = Boolean(process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_SERVICE_ID);
  const header = configured || (railway ? "x-real-ip" : process.env.AICUBER_CUSTOM_SERVER === "1" ? "x-aicuber-peer-ip" : null);
  let value = header ? request.headers.get(header)?.trim() : null;
  if (header === "x-forwarded-for") value = value?.split(",").at(-1)?.trim();
  if (value && isIP(value)) {
    if (isIP(value) === 6) return new URL(`http://[${value}]/`).hostname.toLowerCase();
    return value;
  }
  if (!warnedMissingIp && process.env.NODE_ENV === "production") {
    warnedMissingIp = true;
    console.warn("[rate-limit] client IP unavailable; configure a trusted ingress header. Anonymous requests share a fallback bucket.");
  }
  return "unknown";
}

function localCount(key: string, windowMs: number) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.expiresAt <= now) {
    if (buckets.size >= maxBuckets) {
      for (const [entry, value] of buckets) if (value.expiresAt <= now) buckets.delete(entry);
      // Bound memory even if many distinct clients arrive in one window.
      if (buckets.size >= maxBuckets) buckets.delete(buckets.keys().next().value!);
    }
    bucket = { count: 0, expiresAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count = Math.min(bucket.count + 1, Number.MAX_SAFE_INTEGER);
  return { count: bucket.count, ttl: Math.max(1, bucket.expiresAt - now) };
}

export async function consumeRateLimit(policy: RateLimitPolicy, identity: string) {
  const key = `aicuber:rate:v1:${policy.name}:${createHash("sha256").update(identity).digest("hex")}`;
  // Keep a shadow counter so a Redis outage does not reset a client's local allowance.
  const local = localCount(key, policy.windowMs);
  if (getRedisUrlFrom(redisNames) && Date.now() >= redisRetryAt) {
    try {
      const result = await withRedis(redisNames, async command => command(["EVAL", incrementScript, "1", key, String(policy.windowMs)]), { timeoutMs: 1000 });
      if (!Array.isArray(result) || typeof result[0] !== "number" || typeof result[1] !== "number" || !Number.isSafeInteger(result[0]) || !Number.isSafeInteger(result[1]) || result[0] < 1 || result[1] <= 0) throw new Error("invalid_rate_counter");
      return { count: result[0], ttl: result[1] };
    } catch {
      if (Date.now() >= redisRetryAt) console.warn("[rate-limit] Redis unavailable; using process-local counters for 30 seconds.");
      redisRetryAt = Date.now() + 30_000;
    }
  }
  return local;
}

export async function rateLimitRequest(request: Request, userId?: string, admin = false): Promise<NextResponse | null> {
  const rawPath = new URL(request.url).pathname;
  let path = rawPath;
  try { path = decodeURIComponent(path).replace(/\/+$/, ""); } catch { /* Classify malformed paths conservatively. */ }
  const policy = requestRateLimit(rawPath, request.method, Boolean(userId), admin);
  if (!policy) return null;
  const identity = policy.name === "auth" || !userId ? `ip:${requestClientIp(request)}` : `user:${userId}`;
  const usage = await consumeRateLimit(policy, identity);
  if (usage.count > policy.limit) {
    if (usage.count === policy.limit + 1) console.warn("[rate-limit] threshold reached", { policy: policy.name });
    return NextResponse.json({ error: "Too many requests. Please wait and try again." }, { status: 429, headers: {
      "Retry-After": String(Math.max(1, Math.ceil(usage.ttl / 1000))), "Cache-Control": "private, no-store"
    } });
  }
  if (userId && path === "/api/chat" && request.method === "POST") {
    const soft = await consumeRateLimit(chatSoftLimit, identity);
    if (soft.count === chatSoftLimit.limit + 1) console.warn("[rate-limit] chat soft threshold reached", { policy: chatSoftLimit.name });
  }
  return null;
}
