#!/usr/bin/env bash
# Set a single Docker secret value under ./secrets/<NAME>.
#
# Usage:
#   scripts/set-secret.sh NAME "value"     # value on the command line
#   scripts/set-secret.sh NAME             # prompt (hidden input)
#   printf '%s' "value" | scripts/set-secret.sh NAME -   # read from stdin
#
# The file is written with 0600 perms and NO trailing newline.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS_DIR="${SECRETS_DIR:-$SCRIPT_DIR/../secrets}"

name="${1:-}"
if [ -z "$name" ]; then
  echo "usage: $0 NAME [VALUE|-]" >&2
  exit 1
fi

case "$name" in
  *[!A-Za-z0-9_]*)
    echo "error: invalid secret name '$name' (use A-Z, 0-9, underscore)" >&2
    exit 1
    ;;
esac

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR" 2>/dev/null || true

if [ "$#" -ge 2 ]; then
  if [ "$2" = "-" ]; then
    value="$(cat)"
  else
    value="$2"
  fi
else
  printf 'Enter value for %s: ' "$name" >&2
  read -rs value
  printf '\n' >&2
fi

target="$SECRETS_DIR/$name"
old_umask="$(umask)"
umask 177
printf '%s' "$value" > "$target"
umask "$old_umask"
chmod 600 "$target"

echo "wrote $target ($(wc -c < "$target" | tr -d ' ') bytes)" >&2
