#!/usr/bin/env bash
# Apply every file in supabase/migrations in filename order to one database.
#
# Usage:
#   scripts/apply-migrations.sh                     # target = DATABASE_URL from .env
#   scripts/apply-migrations.sh "postgresql://…"    # or an explicit target URL
#
# FRESH DATABASES ONLY. The set is not re-runnable: 0001, 0002 and 0008 issue
# `create policy` with no `drop policy if exists` guard, so a second pass aborts
# with "policy already exists". Later files (0015, 0019, 0023, 0025) do guard.
# To apply new migrations to an already-migrated database, run those files
# individually with psql rather than this script.
#
# There is no migrations ledger — scripts/check-schema-drift.mjs is what tells
# you whether the live schema matches. Everything runs in ONE transaction with
# ON_ERROR_STOP, so a failure half way leaves the target untouched rather than
# half-migrated, which keeps a retry pointed at a genuinely empty database.
#
# Use the target's DIRECT connection (port 5432) or the session pooler. The
# transaction pooler (port 6543) is fine for DDL but pointless here, and it
# breaks the sibling restore.sh, so keep one habit for both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/supabase/migrations"

TARGET_URL="${1:-}"

if [ -z "$TARGET_URL" ] && [ -f "$ROOT/.env" ]; then
  # Read DATABASE_URL out of .env without sourcing the whole file.
  TARGET_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | tail -n 1 | cut -d= -f2- | sed -E 's/^["'\'']//; s/["'\'']$//')"
fi

if [ -z "$TARGET_URL" ]; then
  echo "target db url required (argument or DATABASE_URL in .env)" >&2
  exit 1
fi

shopt -s nullglob
FILES=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob

if [ ${#FILES[@]} -eq 0 ]; then
  echo "no migrations found in $MIGRATIONS_DIR" >&2
  exit 1
fi

PSQL_ARGS=()
for file in "${FILES[@]}"; do
  echo "==> $(basename "$file")"
  PSQL_ARGS+=(--file "$file")
done

psql --single-transaction --variable ON_ERROR_STOP=1 \
  "${PSQL_ARGS[@]}" \
  --dbname "$TARGET_URL"

echo "==> Applied ${#FILES[@]} migrations."
echo "==> Verify with: DATABASE_URL='<target>' npm run schema:check"
