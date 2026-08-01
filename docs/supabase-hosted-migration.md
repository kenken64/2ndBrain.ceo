# Migrating from self-hosted Supabase (Railway) to hosted Supabase

Moving the app off the self-hosted Supabase stack behind
`https://kong-production-f326.up.railway.app` and onto the hosted project
`hiwyqusgejorhyvueadq`.

Status: **not executed.** Everything below is verified against the codebase, but
nothing has been run — two values are still missing (see [Blockers](#blockers)).

> **The old database is already unreachable** (verified 31 Jul 2026). No further
> backup can be taken from it; `backup-restore/20260718-221015/` is the only
> surviving copy and it is untracked. See
> [The source database is already gone](#the-source-database-is-already-gone).

Related: [`supabase-railway.md`](./supabase-railway.md) for the original setup,
[`../backup-restore/README.md`](../backup-restore/README.md) for the dump/restore
tooling.

---

## Blockers

Neither can be worked around; both come from the new project's dashboard.

| Value | Where to get it | What breaks without it |
| --- | --- | --- |
| Service role **secret key** (`sb_secret_…`) | Settings → API Keys | Every server-side write. 42 references across the codebase resolve through `lib/supabase/admin.ts:11-15`. The old `service_role` JWT is signed with the self-hosted JWT secret and will 401. |
| Database **password** | Settings → Database (or reset it there) | The migration run. `DATABASE_URL` is only used by `scripts/*`, never at runtime, so the app boots without it — but the schema never gets created. |

---

## 1. Railway variables

Only four lines change. Everything else in the service (AWS, OpenAI, Telegram,
Redis, Solana, Gyne, marketplace secrets) is unrelated to Supabase.

```bash
NEXT_PUBLIC_SUPABASE_URL="https://hiwyqusgejorhyvueadq.supabase.co"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_CR5eizESUggUCwKKlehSlw_m0gXp-w7"
SUPABASE_SERVICE_ROLE_KEY="sb_secret_…"          # blocker — from the new project
DATABASE_URL="postgresql://postgres:<PW>@db.hiwyqusgejorhyvueadq.supabase.co:5432/postgres"
```

**Delete** `NEXT_PUBLIC_SUPABASE_ANON_KEY`. It holds the old self-hosted Kong
anon JWT. It is currently harmless — `lib/env.ts:18-23` checks the publishable
name first — but leaving a stale credential named like a live one invites a
wrong diagnosis later.

### Rebuild, don't just restart

`NEXT_PUBLIC_*` values are inlined into the browser bundle at build time by the
Dockerfile (`Dockerfile:12-23` for the builder stage, `Dockerfile:31-47` for the
runtime stage). A variable change that only triggers a restart leaves the old
project ref compiled into the served JavaScript.

Confirm the new ref actually reaches the browser before debugging anything else:

```bash
curl -s https://kere.ceo/ | grep -o 'hiwyqusgejorhyvueadq' | head -1
```

### Also set `OPENCLAW_SSH_TOKEN_SECRET`

Not currently set on Railway. `app/api/openclaw/ssh-token/route.ts:31-47` and
`server/openclaw-ssh.js:52-67` resolve their HMAC secret through a fallback
chain that lands on `SUPABASE_SERVICE_ROLE_KEY`. So today, rotating the service
role key silently rotates the SSH console token secret too.

```bash
OPENCLAW_SSH_TOKEN_SECRET="$(openssl rand -hex 32)"
```

Live console tokens have a 60s TTL, so the rotation itself is a non-event — the
point is to stop coupling two unrelated secrets. `scripts/secrets.list:13`
already treats this as a generated secret for the docker-compose path; Railway
just never got one.

---

## 2. Code changes

### The anon → publishable switch needs none

Every resolver already prefers the publishable name, and has for a while:

| File | Line | Order |
| --- | --- | --- |
| `lib/env.ts` | 18-23 | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` → `NEXT_PUBLIC_SUPABASE_ANON_KEY` → `SUPABASE_PUBLISHABLE_KEY` → `SUPABASE_ANON_KEY` |
| `app/api/admin/access-check/route.ts` | 14-19 | same |
| `app/api/openclaw/ssh-token/route.ts` | 32-40 | same, after `OPENCLAW_SSH_TOKEN_SECRET` and the service key |
| `server/openclaw-ssh.js` | 57-61 | same |
| `Dockerfile` | 13, 32 | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` already declared as a build ARG |

The `sb_publishable_…` format is never parsed as a JWT. The only place that
decodes a key (`app/api/admin/access-check/route.ts:38-44`) is a diagnostics
endpoint whose `decodeJwtPart` returns `null` on failure, so a non-JWT key
yields null `alg`/`role`/`iss` fields rather than throwing.

The service role path is equally format-agnostic —
`lib/supabase/admin.ts:37-51` passes whatever string it finds straight to
`createClient`.

### What was added

There was no migration runner; `docs/supabase-railway.md:9` told you to paste
the files into the SQL editor by hand.

- **`scripts/apply-migrations.sh`** — applies every `supabase/migrations/*.sql`
  in filename order, in a **single transaction** with `ON_ERROR_STOP=1`, so a
  mid-run failure rolls the target back to empty instead of leaving it half
  migrated. Falls back to `DATABASE_URL` from `.env` when no argument is given.
- **`npm run db:migrate`** in `package.json`.

Safe to wrap in one transaction: no migration uses `CREATE INDEX CONCURRENTLY`
and none contains psql meta-commands (verified by grep across all 27 files).

Syntax-checked with `bash -n`. **Not yet run against a live database** — see
[Pre-flight](#pre-flight-static-validation) for what was verified instead.

#### The runner is fresh-database-only

The migration set is **not** re-runnable. `0001`, `0002` and `0008` issue
`create policy` with no `drop policy if exists` guard — 27 such statements —
so a second pass aborts with *policy already exists*. Later files (`0015`,
`0019`, `0023`, `0025`) do guard theirs.

This does not affect the cutover, which targets an empty database, and the
single-transaction wrapper means a failed attempt rolls back to empty so a retry
is still a first run. It does mean **`npm run db:migrate` is the wrong tool for
applying migration 0028 later** — run new files individually with psql.

All `create table` statements do use `if not exists`; policies are the sole
exception.

### Pre-flight: static validation

Docker and a local Postgres server were both unavailable (`libpq` is installed
without server binaries), so the migrations could not be dry-run against a
throwaway target. A static dependency scan was run in their place:

- **0 forward or missing references** across all 27 files. Every foreign-key
  target, `alter table` target, index target and trigger target is created by an
  earlier file, so the single-transaction run will not abort on ordering.
- 31 tables created, no schemas created (confirming the `private` schema gap
  noted below).
- The only non-idempotent DDL is the `create policy` set described above.

---

## 3. Running the migrations

Decision taken: **migrations only**, into an empty database. The alternative
(fresh `backup.sh` + `restore.sh`, carrying users and data across) was
considered and declined.

```bash
POOLER="postgresql://postgres.hiwyqusgejorhyvueadq:<PW>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"

npm run db:migrate -- "$POOLER"
DATABASE_URL="$POOLER" npm run schema:check
```

#### Connection endpoints — both verified reachable

**Session pooler (recommended).** `aws-0-ap-southeast-1.pooler.supabase.com:5432`
is dual-stack and routes to this project. Region and pooler instance were
confirmed by elimination: `aws-1-ap-southeast-1` rejects the tenant outright
(`ENOTFOUND tenant/user postgres.hiwyqusgejorhyvueadq not found`) while `aws-0`
reaches password authentication, so the tenant lives on `aws-0`.

Session mode (`:5432`) is required — the transaction pooler (`:6543`) cannot run
the multi-statement transaction the runner uses. Note the username format
differs: `postgres.<project-ref>`, not plain `postgres`.

**Direct connection.** `db.hiwyqusgejorhyvueadq.supabase.co` publishes **only an
AAAA record**. It is reachable over IPv6 — connecting to the literal address
gets all the way to password authentication — but this machine's resolver will
not resolve the hostname:

```
psql: error: could not translate host name "db.hiwyqusgejorhyvueadq.supabase.co"
      to address: nodename nor servname provided, or not known
```

So the direct endpoint works only via the literal address:

```bash
psql "postgresql://postgres:<PW>@[2406:da18:e5c:b702:beea:e1de:ac1f:b132]:5432/postgres"
```

That address is not guaranteed stable, which is the other reason to prefer the
pooler hostname.

This affects the migration run only. `DATABASE_URL` is never read at runtime, so
Railway is unaffected either way.

`schema:check` (`scripts/check-schema-drift.mjs`) is read-only and exits 1 on
drift — it is the only thing that catches a skipped migration, since there is no
ledger table.

### Consequences of the empty-DB path

**Re-seed the admin allowlist**, or `/admin` locks everyone out. The row is data,
not schema:

```bash
npm run admin:load -- --email bunnyppl@gmail.com
```

That was the single `admin_users` row on the old database.

**The `private` schema is not recreated.** `private.update_user_avatar_img_name()`
exists on the old database and in the dump, but no migration creates it — it is a
trigger function on `storage.objects`. Harmless here: avatars are written to the
filesystem via `AVATAR_STORAGE_ROOT` (`lib/avaturn.ts:21`), not to Supabase
Storage, and `storage.objects` is empty in the dump. Worth knowing only because
it means migrations alone do not reproduce the old schema byte for byte.

**The profiles trigger *is* covered** — `supabase/migrations/0001_app_schema.sql:77-105`
creates `public.handle_new_user()` and the `on_auth_user_created` trigger on
`auth.users`, so new sign-ins still get a `profiles` row.

### What is being left behind

From `backup-restore/20260718-221015` (dumped 18 Jul 2026):

| Table | Rows |
| --- | --- |
| `auth.users` | 11 |
| `public.profiles` | 11 |
| `public.wiki_pages` | 186 |
| `public.openclaw_instances` | 2 |
| `public.admin_users` | 1 |

That dump is 13 days old, and it is now the **only** copy.

#### The source database is already gone

Verified 31 Jul 2026. The Railway TCP proxy still accepts connections on
`tramway.proxy.rlwy.net:56240`, but the Postgres behind it closes every session
immediately:

```
psql: error: connection to server ... failed: server closed the connection unexpectedly
```

`nc -z` confirms the port is open, so this is the upstream service being down or
removed, not a network or credential problem. A fresh `backup-restore/backup.sh`
is therefore no longer possible, and `npm run schema:check` cannot be run against
the old schema to confirm the migration files reproduce it.

Consequences:

- **`backup-restore/20260718-221015/` is irreplaceable.** It is untracked and
  gitignored (it contains user PII), so it exists on one machine only. If those
  11 users or 186 wiki pages might ever be wanted, copy that folder somewhere
  durable before the machine changes. Everything in it can still be restored
  into the new project later via `backup-restore/restore.sh`.
- If the Railway Postgres service can be restarted, doing so before final
  teardown would allow a current dump. Whether that is worth it depends on how
  much changed between 18 and 31 July.
- The chosen empty-database path is unaffected — it was never going to carry
  this data across.

---

## 4. Supabase dashboard configuration

On the self-hosted stack these were GoTrue/PostgREST environment variables. On
hosted they are dashboard settings.

| Self-hosted env | Hosted equivalent |
| --- | --- |
| `GOTRUE_SITE_URL` | Auth → URL Configuration → **Site URL** = `https://kere.ceo` |
| `GOTRUE_URI_ALLOW_LIST` | Auth → URL Configuration → **Redirect URLs** (below) |
| `GOTRUE_EXTERNAL_GOOGLE_ENABLED` / `_CLIENT_ID` / `_SECRET` | Auth → Sign In / Providers → **Google**: enable, paste client ID + secret |
| `GOTRUE_DISABLE_SIGNUP` | Auth → Sign In / Providers → allow new users |
| `GOTRUE_JWT_EXP`, mailer settings | Auth → Sessions, Auth → Emails |
| `ANON_KEY` / `SERVICE_ROLE_KEY` / `JWT_SECRET` | Settings → API Keys — the new project mints its own; none of the old values carry over |
| `PGRST_DB_SCHEMAS` | Settings → API → Exposed schemas. Default `public` is sufficient — nothing reaches `private` over PostgREST (no `.schema("private")` calls in the codebase) |
| Storage service env | Not applicable — avatars are on the filesystem, `storage.objects` is empty |

### Redirect URLs (Supabase → Auth → URL Configuration)

```
https://kere.ceo/auth/callback
http://localhost:3000/auth/callback
https://<your-railway-domain>/auth/callback
```

These match what `app/auth/login/route.ts:28` builds and
`app/auth/callback/route.ts:128` consumes.

### The step that will bite you

In the **Google Cloud console**, on whichever OAuth client Supabase Auth uses,
add this authorized redirect URI:

```
https://hiwyqusgejorhyvueadq.supabase.co/auth/v1/callback
```

The old one pointed at the Kong domain. Miss this and login fails with
`redirect_uri_mismatch` *after* every environment variable looks correct — the
most expensive kind of mistake to diagnose.

This is a different OAuth client from `GWS_OAUTH_CLIENT_ID`, which is the app's
own Google Workspace integration and does not change.

### Extensions

Only `pgcrypto` is required (`supabase/migrations/0001_app_schema.sql:1`,
`create extension if not exists`). Available on hosted Supabase by default.

---

## 5. Cutover order

1. Create the new project; note the secret key and DB password.
2. Configure Auth: Site URL, redirect URLs, Google provider.
3. Add the new callback URI to the Google Cloud OAuth client.
4. Run `npm run db:migrate`, then `npm run schema:check`.
5. Seed the admin allowlist: `npm run admin:load -- --email bunnyppl@gmail.com`.
6. Update the four Railway variables; delete `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
   add `OPENCLAW_SSH_TOKEN_SECRET`.
7. Trigger a **rebuild** and verify the new project ref appears in the served JS.
8. Sign in end to end, then hit `/api/admin/access-check` — it reports the
   resolved key source, fingerprint and whether the service role key is wired.
9. Keep the old Railway Supabase running until step 8 passes.

Expect every existing session to be invalidated by the JWT secret change. On the
empty-DB path users are also re-created from scratch on first sign-in.

---

## 6. Credential hygiene

The environment block used to plan this migration was pasted in full into a chat
transcript. The Supabase values are being retired anyway. These are not:

- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
- `OPENAI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `REDIS_URL` / `TOKEN_QUOTA_REDIS_URL` (contain the Redis password)
- The generated shared secrets: `GYNE_AGENT_SESSION_SECRET`,
  `MARKETPLACE_*_SECRET`, `INSTANCE_REAPER_SECRET`,
  `PSLE_ENG_TUTOR_SESSION_SECRET`

Rotating them is unrelated to this migration and can happen on its own schedule.
