#!/usr/bin/env bash
# Scaffold all Docker secrets defined in scripts/secrets.list.
#
#   generate -> create a random 32-byte hex value if not already set
#   provide  -> import from .env if present; otherwise create an empty file + warn
#   optional -> import from .env if present; otherwise leave empty (feature disabled)
#
# Existing non-empty secret files are never overwritten. Re-run any time to fill gaps.
# Override the .env source with ENV_FILE=..., or the output dir with SECRETS_DIR=...
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SECRETS_DIR="${SECRETS_DIR:-$ROOT_DIR/secrets}"
LIST_FILE="${LIST_FILE:-$SCRIPT_DIR/secrets.list}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

if [ ! -f "$LIST_FILE" ]; then
  echo "error: secret list not found: $LIST_FILE" >&2
  exit 1
fi

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR" 2>/dev/null || true
# Belt-and-suspenders: never let this directory get committed.
if [ ! -f "$SECRETS_DIR/.gitignore" ]; then
  printf '*\n!.gitignore\n' > "$SECRETS_DIR/.gitignore"
fi

# Read a KEY's value from .env (last match wins), stripping surrounding quotes.
env_value() {
  local key="$1" line val
  [ -f "$ENV_FILE" ] || return 1
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" | tail -n1 || true)"
  [ -n "$line" ] || return 1
  val="${line#*=}"
  val="${val%\"}"; val="${val#\"}"
  val="${val%\'}"; val="${val#\'}"
  printf '%s' "$val"
}

write_secret() {
  local target="$1" value="$2" old_umask
  old_umask="$(umask)"; umask 177
  printf '%s' "$value" > "$target"
  umask "$old_umask"
  chmod 600 "$target"
}

missing=0
while IFS= read -r raw || [ -n "$raw" ]; do
  case "$raw" in ''|\#*) continue ;; esac
  name="${raw%%:*}"
  kind="${raw#*:}"
  kind="${kind%%[[:space:]]*}"
  target="$SECRETS_DIR/$name"

  if [ -s "$target" ]; then
    printf '  keep      %s (already set)\n' "$name"
    continue
  fi

  case "$kind" in
    generate)
      # Prefer an existing .env value — these secrets are paired with deployed
      # services, so a fresh random value would break that pairing.
      if val="$(env_value "$name")" && [ -n "$val" ]; then
        write_secret "$target" "$val"
        printf '  import    %s (from .env)\n' "$name"
      else
        write_secret "$target" "$(openssl rand -hex 32)"
        printf '  generate  %s\n' "$name"
      fi
      ;;
    provide|optional)
      if val="$(env_value "$name")" && [ -n "$val" ]; then
        write_secret "$target" "$val"
        printf '  import    %s (from .env)\n' "$name"
      else
        write_secret "$target" ""
        if [ "$kind" = "provide" ]; then
          printf '  MISSING   %s -> scripts/set-secret.sh %s\n' "$name" "$name"
          missing=$((missing + 1))
        else
          printf '  empty     %s (optional)\n' "$name"
        fi
      fi
      ;;
    *)
      printf '  ??        %s (unknown kind: %s)\n' "$name" "$kind" >&2
      ;;
  esac
done < "$LIST_FILE"

echo
echo "Secrets directory: $SECRETS_DIR"
if [ "$missing" -gt 0 ]; then
  echo "WARNING: $missing required secret(s) still empty — set them before deploying."
fi
echo "Set/replace one with: scripts/set-secret.sh NAME"
echo "Run with secrets:      docker compose -f docker-compose.yml -f docker-compose.secrets.yml up --build"
