export const runtime = "nodejs";

/** CSP reports are untrusted. Log only a directive and origin, never URLs with tokens or user content. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    if (!request.body) return new Response(null, { status: 400 });
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 16_384) { await reader.cancel(); return new Response(null, { status: 413 }); }
      chunks.push(part.value);
    }
    body = JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size).toString("utf8"));
  } catch { return new Response(null, { status: 400 }); }
  const report = (body as { "csp-report"?: Record<string, unknown> })?.["csp-report"];
  const directive = report?.["effective-directive"] ?? report?.["violated-directive"];
  if (typeof directive !== "string" || !/^[a-z-]{1,80}$/.test(directive)) return new Response(null, { status: 400 });
  const blocked = report?.["blocked-uri"];
  let blockedOrigin = "unknown";
  if (blocked === "inline" || blocked === "eval" || blocked === "wasm-eval") blockedOrigin = blocked;
  else if (typeof blocked === "string") {
    try { const url = new URL(blocked); if (["https:", "http:", "wss:", "ws:"].includes(url.protocol)) blockedOrigin = url.origin; } catch { /* omit malformed URLs */ }
  }
  console.warn("[security:csp] report-only violation", { directive, blockedOrigin });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
