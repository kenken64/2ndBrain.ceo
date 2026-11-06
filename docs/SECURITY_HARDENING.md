# Security headers and request throttling

The implementation follows `SECURITY_FIXES_IMPACT_ANALYSIS.md` with adjustments for the app's actual integrations. Limits are enforced in the Next.js proxy before API handlers perform paid or privileged work. Existing authentication, MFA, credit reservations and payment idempotency checks remain required.

## Request policies

| Requests | Allowance | Identity |
| --- | --- | --- |
| Email auth and OAuth starts | 5 per 15 minutes | Trusted client IP |
| Other anonymous API requests | 100 per 15 minutes | Trusted client IP |
| Authenticated writes, including batch jobs | 500 per 15 minutes | Verified user ID |
| Billing writes | 20 per minute | Verified user ID |
| Authenticated reads and video status polling | 1,000 per minute | Verified user ID |
| Verified admin API calls | 10,000 per 15 minutes | Verified admin user ID |
| CSP reports | 30 per minute | Verified user ID or trusted IP |

Chat also logs a warning when a user exceeds 50 chat requests in five minutes. That warning does not reject the request; the general hard limit still protects against sustained abuse. A blocked request receives HTTP 429 with `Retry-After` and `Cache-Control: private, no-store`. Refreshed session cookies are preserved.

Webhook delivery, OAuth completion callbacks, health checks, internal job routes, marketplace launch verification and secret-protected renewal jobs are excluded from user quotas. Their existing signature, token or secret checks still apply. Logout and public page navigation are not throttled by these policies. Rate limiting reduces request abuse; it does not replace payment reconciliation or prevent every duplicate checkout.

Counters use atomic Redis increments and expiry. Set `RATE_LIMIT_REDIS_URL`, or the app reuses `TOKEN_QUOTA_REDIS_URL` / `REDIS_URL`. Keys contain hashed identities and expire after their window. Without Redis, counters are process-local and bounded in memory; they reset on restart and are not shared between instances. Redis failure uses the local shadow counters and retries Redis after 30 seconds. Configure shared Redis for deployments with multiple app instances.

### Client IP trust

Railway deployments automatically read the platform's overwritten `X-Real-IP`. On another reverse proxy, set `RATE_LIMIT_TRUSTED_IP_HEADER` only to a header that ingress overwrites, and prevent direct access to the origin. For `x-forwarded-for`, the rightmost entry must be the address appended by that trusted ingress. Arbitrary client-provided forwarding headers are otherwise ignored.

The custom Node server overwrites an internal peer-address header for direct connections. If no reliable address is available, anonymous requests share an `unknown` bucket and a production warning is logged; configure ingress before a production rollout to avoid grouping unrelated users. Do not manually set `AICUBER_CUSTOM_SERVER`; the Node entrypoint manages that internal flag.

## Response headers

The app disables `X-Powered-By` and sends:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-XSS-Protection: 0` to disable deprecated browser XSS filtering
- `Strict-Transport-Security: max-age=31536000` in production builds
- `Content-Security-Policy-Report-Only`

HSTS intentionally does not include `includeSubDomains` or preload: those require confirming HTTPS across every affected subdomain. The CSP is a rollout policy, not an enforced XSS boundary. It accommodates Lemon.js, the configured Supabase and Avaturn origins, blob workers/WASM, images and the CloudFront marketing video. Frames currently allow HTTPS because agent gateways have dynamic per-instance hosts. Inline scripts/styles remain allowed for the current app; removing them requires a nonce-based design.

Existing enforced policies on private file previews remain in place. Server-to-server OpenRouter, AWS, Zoom and Google requests do not require browser CSP allow-list entries.

## CSP reports and rollout

Browsers send report-only violations to `POST /api/security/csp-report`. The endpoint limits bodies to 16 KiB and logs only the directive and blocked origin under `[security:csp]`. It does not log document URLs, query strings, paths or script samples. Reports are untrusted observations, not instructions or proof of an attack.

Before enabling enforcement, review reports while testing sign-in, signup/recovery, Avaturn, Lemon Squeezy checkout and wallets, Phantom, saved-file previews, graph/workspace embeds, the SSH console, and `/watch`. Refine allowed origins and scripts from those results. The report-only stage does not block these flows. Collect representative staging traffic for 24–48 hours before changing the header to `Content-Security-Policy`; this staging observation has not been performed by the automated checks.

Headers are resolved by `next.config.ts` at build time. Rebuild/redeploy after changing their source configuration. Rate-limit Redis and trusted-IP settings are runtime server variables.

## Verification

Run `node --test tests/security-hardening.test.cjs`. The suite checks auth/IP isolation, user quotas, polling and webhook exemptions, proxy cookie preservation, CSP report sanitization and headers. The Redis integration check uses a temporary local `redis-server`; it skips when that binary is not installed. It verifies concurrent counters across limiter instances and command timeouts without connecting to production Redis.

Watch `[rate-limit]` warnings and HTTP 429 responses after rollout. Investigate Redis fallback and missing-IP warnings before raising thresholds. Inspect `[security:csp]` reports before enforcement. Public-page floods, websocket connection abuse and attacks that bypass the app server require ingress-level protection; these counters cover HTTP routes matched by the Next.js proxy.

References: [Next.js response headers](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers), [Railway ingress headers](https://docs.railway.com/networking/public-networking/specs-and-limits), and [MDN on deprecated XSS filtering](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-XSS-Protection).
