# Supabase backup / restore

Dump the DDL + DML of the Supabase Postgres pointed to by `DATABASE_URL` in
`.env`, in a layout restorable into a fresh Supabase project (hosted or
self-hosted).

## Backup

```bash
backup-restore/backup.sh                # source = DATABASE_URL from .env
backup-restore/backup.sh "postgres://…" # or an explicit source URL
```

Produces `backup-restore/<timestamp>/`:

| File | Contents |
| --- | --- |
| `01_schema.sql` | DDL for the app schemas (`public`, `private`): tables, functions, triggers, indexes, RLS policies, grants. No managed schemas — those already exist on any Supabase target. |
| `02_data.sql` | Data (COPY) for `public` + `private`, plus `auth` and `storage` rows so users, identities and bucket/object metadata survive the move. Excludes `auth.schema_migrations` / `storage.migrations` (the target keeps its own). |
| `03_managed_triggers.sql` | Custom triggers that live on managed tables (`on_auth_user_created` on `auth.users`, avatar trigger on `storage.objects`) — invisible to a schema-only dump of the app schemas. |

## Restore

```bash
backup-restore/restore.sh "<target-db-url>" backup-restore/<timestamp>
```

Runs everything in one transaction with `session_replication_role = replica`
during the data load (Supabase's documented migration flow), so FK order and
the `auth.users` → `profiles` trigger can't interfere.

Use the target's **direct** connection (port 5432) or session pooler — the
transaction pooler (port 6543) can't run COPY-based restores. The target
project should be empty (fresh project) — the scripts don't drop existing
objects.

## Not covered by a SQL dump

- **Storage files**: only bucket/object *metadata* is in the dump. The actual
  files in the `avatars` bucket live in the storage backend and must be copied
  separately (e.g. download/re-upload via the storage API).
- **Keys and sessions**: the target project has its own JWT secret, anon and
  service-role keys. Update `.env` after switching; sessions/refresh tokens
  from the dump die with the old JWT secret. Users and passwords still work.
- **Vault secrets**: encrypted with the source project's key (source vault was
  empty at the time this was written).
- **Roles**: no custom roles exist; the standard Supabase roles are already on
  the target.

Timestamped dump folders are gitignored — they contain user PII and tokens.
Never commit them.
