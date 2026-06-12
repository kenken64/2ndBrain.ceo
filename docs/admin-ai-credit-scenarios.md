# Admin and User AI Credit Scenarios

This document defines the expected behavior for AI credits, token quota, admin exemptions, and admin drain actions.

## Terms

| Term | Meaning |
| --- | --- |
| AI credits | The user-facing balance backed by `profiles.llm_token_quota - profiles.llm_token_used`. |
| Token quota | The assigned quota stored in `profiles.llm_token_quota`. |
| Used tokens | The consumed amount stored in `profiles.llm_token_used`. |
| Available credits | `max(0, llm_token_quota - llm_token_used)`. |
| Admin account | A profile whose email or user ID matches an enabled row in `admin_users`. |
| Normal user | A profile that is not in the enabled admin allowlist. |
| Drain credits | Admin-only action that moves a normal user's unused AI credits back to the signed-in admin account. |

## Core Rules

1. Normal users are quota-managed.
2. Admin accounts are quota-exempt.
3. Disabled or deleted accounts remain blocked regardless of quota or admin status.
4. Admins can operate the app with zero AI credits.
5. Admins can create projects without consuming `llm_token_used`.
6. Admins do not need token quota assigned to their own account.
7. Admins can send held credits to normal users.
8. Admins can drain unused credits from normal users.
9. Admin accounts should not receive normal user-facing credit transfers.
10. Admin accounts should not be drained by another admin.

## Normal User Scenarios

| Scenario | Expected behavior | Enforcement surface |
| --- | --- | --- |
| User has available AI credits | User can access protected workspace areas and create projects. | Proxy credit lock and project API quota check allow access. |
| User has zero or negative available AI credits | User is locked out of most protected app areas. | `proxy.ts` redirects UI requests to payment and returns `402` for blocked APIs. |
| User has zero credits and needs recovery | User can still access payment/top-up, logout, onboarding, Google Workspace auth, and destroy workspace. | Credit-lock allowlist in `proxy.ts`. |
| User buys credits | `llm_token_quota` increases by the purchased package amount. | Solana billing confirmation flow. |
| User creates a project | Estimated project token cost is checked against available credits, then `llm_token_used` is incremented. | `app/api/projects/route.ts`. |
| User transfers credits to another normal user | Transfer is allowed when sender has enough unused credits. | `/api/billing/credits/recipient` and `/api/billing/credits/transfer`. |
| User attempts to transfer credits to an admin | Transfer is blocked because admins are quota-exempt. | Billing credit recipient and transfer APIs. |
| User is disabled or deleted by admin | User is blocked from protected app access. | `proxy.ts` account disabled/deleted check. |

## Admin Scenarios

| Scenario | Expected behavior | Enforcement surface |
| --- | --- | --- |
| Admin has zero AI credits | Admin can still use the app. | Admin allowlist bypasses credit lock in `proxy.ts`. |
| Admin opens Settings with zero credits | Settings tabs are not credit-locked for the admin. | `app/dashboard/settings/page.tsx`. |
| Admin creates a project | Project creation is allowed without quota check and without incrementing `llm_token_used`. | `app/api/projects/route.ts`. |
| Admin appears in admin users table | Row shows `Quota exempt` and an `admin` badge. | `app/admin/page.tsx` and `components/admin-users-table.tsx`. |
| Admin tries to set quota for an admin account | Quota input is hidden, and direct API calls are rejected. | Admin users table and `/api/admin/users/[userId]/quota`. |
| Admin tries to send credits to another admin account | Transfer is blocked because admins are not quota-managed recipients. | Billing credit recipient and transfer APIs. |
| Admin sends credits to a normal user | Transfer is allowed if the admin account holds enough unused credits. | Existing transfer RPC through `/api/billing/credits/transfer`. |
| Admin drains credits from a normal user | Drain is allowed when the normal user has unused credits. | `/api/admin/users/[userId]/credits/drain`. |
| Admin drains credits from another admin | Drain is blocked because admin accounts are quota-exempt. | Drain API and admin users table. |
| Admin disables or deletes own account | Controls are hidden and direct self-disable/self-delete requests are rejected. | Admin users table plus admin access/delete APIs. |
| Admin disables or deletes a normal user | Action is allowed if the admin is MFA-verified. | Admin user access/delete APIs. |

## Drain Behavior

Drain is intentionally separate from normal transfer.

| Item | Behavior |
| --- | --- |
| Source | A non-admin target user. |
| Destination | The signed-in admin account. |
| Amount | The target user's unused credits: `max(0, llm_token_quota - llm_token_used)`. |
| Result for target user | `llm_token_quota` decreases by the drained amount. |
| Result for admin | `llm_token_quota` increases by the drained amount, so the admin can redistribute held credits later. |
| Audit | The admin drain route logs `ai_credit_admin_drain` to `admin_audit_events`. |

## UI Expectations

| Surface | Normal user row | Admin row |
| --- | --- | --- |
| Usage column | Shows remaining, used, and assigned credits. | Shows `Quota exempt`, `Admin account`, and `No AI credit quota required`. |
| Quota form | Visible. | Hidden. |
| Send credits form | Visible when the row has an email and the signed-in admin has credits. | Hidden with quota-exempt note. |
| Drain credits button | Visible for non-self normal users and disabled when remaining credits are zero. | Hidden. |
| Disable/delete buttons | Visible for non-self rows. | Visible for other admin rows except drain/quota controls; hidden for self destructive actions. |

## Server-Side Guard Summary

| Guard | Purpose |
| --- | --- |
| `isAdminUser(email, userId)` | Shared server-side allowlist check against enabled `admin_users` rows. |
| `proxy.ts` admin bypass | Prevents admins from being locked by zero credits. |
| Project API admin bypass | Lets admins create projects without quota checks or usage increments. |
| Admin quota route guard | Rejects direct quota assignment for admin accounts. |
| Billing recipient/transfer guard | Rejects normal transfers to admin accounts. |
| Admin drain route guard | Rejects draining from admin accounts and self-drain attempts. |

## Redis Event Contract

When `TOKEN_QUOTA_REDIS_URL` or `REDIS_URL` is configured, every quota balance mutation publishes a JSON message to `TOKEN_QUOTA_REDIS_CHANNEL`. The default channel is `2ndbrain:token-quota`.

The quota event name is always `token_quota.updated`.

```json
{
  "actor": {
    "email": "admin@example.com",
    "userId": "admin-user-id"
  },
  "availableTokens": 7500000,
  "deltaTokens": 7500000,
  "email": "user@example.com",
  "event": "token_quota.updated",
  "llmTokenQuota": 7500000,
  "llmTokenUsed": 0,
  "metadata": {
    "transferId": "optional-transfer-or-payment-id"
  },
  "openclawInstance": "gyne-agent",
  "openclaw_instance": "gyne-agent",
  "occurredAt": "2026-06-12T00:00:00.000Z",
  "reason": "admin_quota_update",
  "source": "2ndBrain.ceo",
  "userId": "target-user-id",
  "version": 1
}
```

Published reasons:

| Reason | Meaning |
| --- | --- |
| `admin_quota_update` | Admin set a normal user's token quota directly. |
| `admin_credit_drain_from_user` | Admin drained unused credits from a normal user. |
| `admin_credit_drain_to_admin` | Admin received credits from a drain. |
| `transfer_credit_out` | User sent credits to another normal user. |
| `transfer_credit_in` | User received credits from another normal user. |
| `solana_credit_purchase` | User purchased AI credits with Solana. |
| `project_token_usage` | User consumed estimated project tokens. |
| `bedrock_token_usage` | 2ndBrain received an external tty proxy usage event and incremented `llm_token_used`. |

2ndBrain also consumes tty proxy usage events when `TOKEN_USAGE_REDIS_URL`, `TOKEN_QUOTA_REDIS_URL`, or `REDIS_URL` is configured. The default usage channel is `openclaw:token_usage:v1`.

Incoming usage events map to profiles in this order:

| Event field | Profile field |
| --- | --- |
| `openclaw_instance` or `openclawInstance` | `profiles.openclaw_instance` |
| `profile_id` or `profileId` | `profiles.id` |
| `email`, `user_email`, or `userEmail` | `profiles.email` |

Example inbound usage event:

```json
{
  "type": "openclaw.token_usage.v1",
  "event_id": "usage-event-id",
  "request_id": "request-id",
  "provider": "aws_bedrock",
  "endpoint": "/api/chat",
  "model": "global.anthropic.claude-sonnet-4-6",
  "openclaw_instance": "openclaw-bcd56ecb",
  "email": "user@example.com",
  "llm_token_used_delta": 26,
  "total_tokens": 26,
  "created_at": "2026-06-12T00:00:00.000Z"
}
```

For `openclaw-bcd56ecb`, 2ndBrain loads the profile where `profiles.openclaw_instance = 'openclaw-bcd56ecb'`, adds `llm_token_used_delta` to `profiles.llm_token_used`, then publishes a `token_quota.updated` event with reason `bedrock_token_usage`.
