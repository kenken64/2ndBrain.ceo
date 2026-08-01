#!/usr/bin/env bash
# Dump DDL + DML from the Supabase Postgres in .env (DATABASE_URL) into a
# timestamped folder, in the layout Supabase documents for project-to-project
# migration (schema.sql / data.sql restored with session_replication_role).
#
# Usage: backup-restore/backup.sh [source-db-url]
#   With no argument, DATABASE_URL is read from .env at the repo root.
set -euo pipefail

cd "$(dirname "$0")/.."

SRC_URL="${1:-}"
if [ -z "$SRC_URL" ]; then
  set -a; source .env; set +a
  SRC_URL="${DATABASE_URL:?DATABASE_URL not found in .env}"
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="backup-restore/$STAMP"
mkdir -p "$OUT"

# App schemas to migrate. Managed schemas (auth, storage, realtime, ...) already
# exist on any Supabase target, so only their DATA is dumped, never their DDL.
APP_SCHEMAS=(public private)
SCHEMA_ARGS=(); for s in "${APP_SCHEMAS[@]}"; do SCHEMA_ARGS+=(--schema "$s"); done

echo "==> DDL: ${APP_SCHEMAS[*]} -> $OUT/01_schema.sql"
# --no-owner: source objects may be owned by supabase_admin, which the postgres
# login on a hosted target cannot assign. Grants (anon/authenticated/...) are kept.
pg_dump "$SRC_URL" --schema-only --no-owner --quote-all-identifiers \
  "${SCHEMA_ARGS[@]}" --file "$OUT/01_schema.sql"

echo "==> DML: ${APP_SCHEMAS[*]} + auth + storage data -> $OUT/02_data.sql"
# auth/storage data rides along so users, identities and bucket/object metadata
# survive the move. Their migration-bookkeeping tables must stay excluded or the
# target's GoTrue/storage services break on their own migration history.
pg_dump "$SRC_URL" --data-only --quote-all-identifiers \
  "${SCHEMA_ARGS[@]}" --schema auth --schema storage \
  --exclude-table 'auth.schema_migrations' \
  --exclude-table 'storage.migrations' \
  --file "$OUT/02_data.sql"

echo "==> Custom triggers on managed schemas -> $OUT/03_managed_triggers.sql"
# pg_dump of public/private cannot see triggers attached to auth.* / storage.*
# tables (e.g. on_auth_user_created), so they are re-created from the catalog.
psql "$SRC_URL" -Atc "
  select pg_get_triggerdef(t.oid) || ';'
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace pn on pn.oid = p.pronamespace
  where not t.tgisinternal
    and n.nspname in ('auth','storage')
    and pn.nspname not in ('auth','storage','realtime','extensions')
  order by c.relname, t.tgname;" > "$OUT/03_managed_triggers.sql"

echo "==> Backup complete:"
ls -lh "$OUT"
