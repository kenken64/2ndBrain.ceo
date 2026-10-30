# Zoom connections for marketplace tools

Zoom is a connected account attached to the existing 2ndBrain user. The initial login remains authoritative. The connection flow uses the Supabase Zoom provider through a separate, server-side memory client; it does not write Zoom OAuth results into the primary Supabase cookies, call `setSession` on the main client, update workspace profile email, or send provider tokens to marketplace apps.

## Deploy

1. Apply only `supabase/migrations/0038_zoom_connections.sql` to the existing database. Do not rerun the fresh-database migration script. This creates service-role-only tables and transactional RPCs; authenticated users cannot select the token tables or execute these RPCs.
2. Enable the Zoom provider in Supabase Authentication with the shared Zoom app Client ID and Client Secret. Enable manual identity linking. The Zoom app’s OAuth redirect is `https://YOUR-PROJECT.supabase.co/auth/v1/callback`.
3. In Supabase’s redirect allow list, add `https://YOUR-2NDBRAIN-DOMAIN/api/integrations/zoom/callback**` to allow the connection attempt query string. Keep the existing login callback and login provider settings unchanged.
4. Grant the Zoom app user-level scopes: `user:read:user`, `meeting:read:list_meetings`, `meeting:read:list_upcoming_meetings`, `cloud_recording:read:list_user_recordings`, and `cloud_recording:read:list_recording_files`. For Zoom accounts outside the developer account, check that the app is distributed to external users and that the production credentials are used. Beta/private apps have access restrictions. The external account may also require its Zoom administrator to approve the app.
5. Provide durable encryption-key storage as described below, then deploy this service and Meeting Minutes.
6. An admin who has completed the existing admin TOTP verification opens Marketplace → Zoom → Admin: shared Zoom provider configuration (also available under Settings → Integrations). Save the **same** Client ID and Client Secret configured in Supabase. Supabase does not refresh provider API tokens, so 2ndBrain needs these credentials for Zoom token refresh. They are saved encrypted in PostgreSQL; they are not environment variables. Changing this shared configuration applies immediately and requires all Zoom users to reconnect. It does not change Supabase’s provider settings automatically.
7. Users sign into 2ndBrain normally, select Connect Zoom, then install/launch Meeting Minutes. Zoom consent links to their existing user; it does not replace their login. A candidate Zoom identity already owned by another Supabase user is not merged automatically.

## Runtime configuration

Existing server variables continue to apply:

```dotenv
MEETING_MINUTES_URL=https://YOUR-MINUTES-DOMAIN/api/2ndbrain/launch
MEETING_MINUTES_SESSION_SECRET=MATCHING_RANDOM_SECRET_AT_LEAST_32_BYTES
MARKETPLACE_LAUNCH_VERIFY_SECRET=MATCHING_DIFFERENT_RANDOM_SECRET_AT_LEAST_32_BYTES
```

The existing Supabase server configuration and service-role key are also required. Do not expose service-role keys or integration secrets through `NEXT_PUBLIC_` variables.

By default, the app generates `storage/integrations/zoom-token.key`, mode `0600`. Set `INTEGRATIONS_STORAGE_ROOT` to a durable writable directory, such as `/app/storage/integrations`, and mount a persistent volume there. The directory must be writable by the container's runtime user (the image defaults to UID 1001); pre-provision mounted-directory ownership when necessary. Back up the key with the PostgreSQL records. A lost/corrupt key is never silently replaced when records exist. Only one instance may bootstrap file-key storage; all service replicas must use the same durable key.

Alternatively, supply a stable 32-byte base64url `ZOOM_INTEGRATION_KEY` as a server secret. This replaces file-key storage and allows replicas to use the same key without a shared filesystem. Never rotate either key over existing encrypted records without a migration. No Zoom credentials belong on the Meeting Minutes service.

## Connection flow and primary auth

- The connect endpoint first verifies the current Supabase user and account state.
- Initial connection and the explicit **Link a new Zoom account** action call `linkIdentity({ provider: 'zoom' })` using a separate in-memory Supabase client. This also adds the newly linked Zoom identity as a sign-in method for the same 2ndBrain account. The primary refresh token is deliberately omitted from that client so it cannot rotate the original login session. Reconnection of an already linked identity uses an isolated provider authorization flow. An identity already linked to another user cannot be merged automatically.
- PKCE verifiers are encrypted server-side, bound to a random HttpOnly browser cookie and the original user, expire in ten minutes, and are consumed once.
- The callback requires the same primary signed-in user. It exchanges the code only in the isolated memory client and rejects a result with a different user ID. It never adopts that result as the workspace login, even on failure. Only Zoom provider tokens are stored.
- `/api/integrations/zoom/callback` is excluded from the proxy's generic `?code=` login redirect. `/auth/callback`, email recovery, WeChat login and other existing flows retain their behavior.
- Disconnect invalidates pending attempts and refreshes before attempting Zoom revocation. Disconnect does not sign the user out of 2ndBrain or unlink their original login method. A later reconnect must still match the original user.

## Delegated API

Meeting Minutes calls `POST /api/integrations/zoom/delegate` server-to-server. Its bearer is its signed marketplace session, not a Supabase token or Zoom credential. The endpoint validates the per-tool signature, expiry, issuer, tool ID, original launch timestamp, account state, installation ownership/status and logout revocation on every request. A browser-supplied user ID never chooses the Zoom account.

Only `status`, `meetings`, `recordings` and `transcript` operations are supported. There is no arbitrary URL/API forwarding or token-export operation. The status response includes an opaque connection reference and account-scoped cache hashes. Transcript imports verify the recording host against the connected Zoom user, restrict download hosts to HTTPS Zoom domains, and limit content to 5 MB. Access-token refresh is serialized with a database lease and saves the latest refresh token atomically. Concurrent refresh conflicts are retriable.

Only the opaque connection reference is optionally included in launch claims. Zoom access tokens, refresh tokens, client secrets and Supabase sessions are not sent in launch URLs or browser responses.

## Webhooks

Admins can save the optional Webhook Secret and copy the generated URL into Zoom. The public endpoint verifies the Zoom HMAC signature and timestamp before processing validation/deauthorization. Deauthorization invalidates central connections for that Zoom user; subsequent marketplace requests reflect the change without restarting either service.

## Validation

```sh
npm run test:zoom
node --test tests/email-auth.test.cjs tests/wechat-auth.test.cjs
npm run typecheck
npm run build
```

Use the repository-pinned Node runtime. Tests execute the actual PostgreSQL migration/RPCs in PGlite and cover encryption, owner isolation, primary-login preservation, callback replay, mismatched users, token rotation, logout/disabled/uninstalled sessions and service-only table access. Provider responses are fixtures. Live Supabase linking, Zoom consent/distribution and imports require your configured provider and have not been verified by these tests.

References: [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), [Supabase provider tokens](https://supabase.com/docs/guides/auth/social-sign-in#provider-tokens), [Zoom OAuth](https://developers.zoom.us/docs/integrations/oauth/).
