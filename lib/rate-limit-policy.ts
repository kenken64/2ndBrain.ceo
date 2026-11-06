export type RateLimitPolicy = { name: string; limit: number; windowMs: number; soft?: boolean };
const minute = 60_000;

/** Polling never shares a bucket with writes. Machine callbacks retain their own authentication. */
export function requestRateLimit(path: string, method: string, authenticated: boolean, admin = false): RateLimitPolicy | null {
  try { path = decodeURIComponent(path); } catch { /* Malformed paths still receive the public quota. */ }
  path = path.replace(/\/+$/, "") || "/";
  if (method === "HEAD") method = "GET";
  if (method === "OPTIONS" || path === "/api/health" || path === "/api/billing/lemon/webhook" || path.startsWith("/api/internal/") || path === "/api/marketplace/launch-session/verify" || path === "/api/marketplace/renewals" || ["/auth/callback", "/api/integrations/zoom/callback", "/api/openclaw/gws-auth/callback"].includes(path)) return null;
  if (path === "/auth/login" || path.startsWith("/api/auth/")) return { name: "auth", limit: 5, windowMs: 15 * minute };
  if (path === "/api/security/csp-report") return { name: "csp-reports", limit: 30, windowMs: minute };
  if (!path.startsWith("/api/")) return null;
  if (!authenticated) return { name: "public", limit: 100, windowMs: 15 * minute };
  if (path.startsWith("/api/admin/")) return admin ? { name: "admin", limit: 10_000, windowMs: 15 * minute } : { name: "authenticated", limit: 500, windowMs: 15 * minute };
  if (method === "GET" || (path === "/api/chat/generate-video" && method === "PATCH")) return { name: "polling", limit: 1000, windowMs: minute };
  if (path.startsWith("/api/billing/")) return { name: "billing", limit: 20, windowMs: minute };
  return { name: "authenticated", limit: 500, windowMs: 15 * minute };
}

export const chatSoftLimit: RateLimitPolicy = { name: "chat-warning", limit: 50, windowMs: 5 * minute, soft: true };
