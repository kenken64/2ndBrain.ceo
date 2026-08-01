#!/usr/bin/env bash
# Restore a backup produced by backup.sh into another Supabase project.
#
# Usage: backup-restore/restore.sh <target-db-url> <backup-dir>
#   e.g. backup-restore/restore.sh "postgresql://postgres:PW@db.REF.supabase.co:5432/postgres" \
#          backup-restore/20260718-120000
#
# Use the target's DIRECT connection string (port 5432) or session pooler, not
# the transaction pooler (port 6543) — COPY needs a session-mode connection.
set -euo pipefail

TARGET_URL="${1:?target db url required}"
BACKUP_DIR="${2:?backup dir required}"

for f in 01_schema.sql 02_data.sql 03_managed_triggers.sql; do
  [ -f "$BACKUP_DIR/$f" ] || { echo "missing $BACKUP_DIR/$f" >&2; exit 1; }
done

# session_replication_role=replica disables FK checks and user triggers during
# the data load (Supabase's documented migration flow), so row order and the
# auth->profiles trigger cannot interfere. Triggers go last, after their
# functions exist and the data load can no longer fire them.
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file "$BACKUP_DIR/01_schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$BACKUP_DIR/02_data.sql" \
  --file "$BACKUP_DIR/03_managed_triggers.sql" \
  --dbname "$TARGET_URL"

echo "==> Restore complete."
