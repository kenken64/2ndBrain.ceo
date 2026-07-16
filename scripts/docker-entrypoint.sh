#!/bin/sh
# Container entrypoint.
#
# Turns file-based Docker secrets into environment variables so the app (which
# reads plain env vars) can consume them. For every file in $SECRETS_DIR whose
# name is a valid env-var identifier, its contents are exported under that name.
#
# This is a no-op passthrough when no secrets are mounted (e.g. on Railway),
# so it is always safe as the image's ENTRYPOINT.
set -e

SECRETS_DIR="${SECRETS_DIR:-/run/secrets}"

if [ -d "$SECRETS_DIR" ]; then
  for secret_file in "$SECRETS_DIR"/*; do
    [ -f "$secret_file" ] || continue

    name=$(basename "$secret_file")
    # Only accept plausible env-var names (A-Z, a-z, 0-9, underscore).
    case "$name" in
      *[!A-Za-z0-9_]*) continue ;;
    esac

    # Skip empty secret files so they don't clobber values from env_file/environment.
    [ -s "$secret_file" ] || continue

    # Command substitution strips trailing newlines; internal newlines are preserved.
    value=$(cat "$secret_file")
    export "$name=$value"
  done
fi

exec "$@"
