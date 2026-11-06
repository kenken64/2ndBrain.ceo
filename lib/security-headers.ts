function origin(value: string | undefined) {
  try {
    const url = new URL(value?.trim() ?? "");
    return ["https:", "http:"].includes(url.protocol) ? url.origin : null;
  } catch { return null; }
}

export function securityHeaders() {
  const supabase = origin(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
  const avaturn = origin(process.env.NEXT_PUBLIC_AVATURN_URL);
  const connections = ["'self'", "blob:", "https://*.supabase.co", "wss://*.supabase.co", "https://*.avaturn.dev", "https://*.avaturn.me", "https://*.lemonsqueezy.com", "https://api.mainnet-beta.solana.com", "https://api.devnet.solana.com", supabase, supabase?.replace(/^http/, "ws"), avaturn].filter(Boolean);
  if (process.env.NODE_ENV !== "production") connections.push("ws:", "http://localhost:*");
  const policy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://app.lemonsqueezy.com${process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${[...new Set(connections)].join(" ")}`,
    // Agent gateways and embedded apps use per-instance HTTPS hosts. Narrow after collecting reports.
    "frame-src 'self' https:",
    "worker-src 'self' blob:",
    "media-src 'self' blob: https://d2ol7oe51mr4n9.cloudfront.net",
    "form-action 'self'",
    "report-uri /api/security/csp-report"
  ].join("; ");
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    // Disable legacy browser XSS filtering; CSP is the supported replacement.
    { key: "X-XSS-Protection", value: "0" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Content-Security-Policy-Report-Only", value: policy },
    ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : [])
  ];
}
