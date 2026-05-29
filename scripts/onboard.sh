#!/usr/bin/env bash
#
# Ingest a handoff blob from the project owner and finish local setup.
#
#   ./scripts/onboard.sh '<blob>'      # paste the blob the owner sent you
#   pbpaste | ./scripts/onboard.sh     # or pipe it in from the clipboard
#
# Decodes the blob into .env.local, then runs ./scripts/setup.sh to install
# deps, create the Next.js symlink, and verify. Run this once, right after you
# clone the repo and cd into it.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
ok()   { printf '\033[32m%s\033[0m\n' "$1"; }
err()  { printf '\033[31m%s\033[0m\n' "$1" >&2; }

# Blob from $1, else read from stdin.
BLOB="${1:-}"
if [ -z "$BLOB" ]; then
  if [ -t 0 ]; then
    err "No handoff blob provided."
    err "Usage: ./scripts/onboard.sh '<blob>'   (or pipe it: pbpaste | ./scripts/onboard.sh)"
    exit 1
  fi
  BLOB="$(cat)"
fi

# Strip surrounding whitespace/newlines that copy/paste may introduce.
BLOB="$(printf '%s' "$BLOB" | tr -d '[:space:]')"

DECODED="$(printf '%s' "$BLOB" | openssl base64 -d -A 2>/dev/null || true)"
if ! printf '%s' "$DECODED" | grep -q '^NEXT_PUBLIC_SUPABASE_URL='; then
  err "That doesn't look like a valid handoff blob (decode failed or missing keys)."
  err "Re-copy the single line the owner sent — including the trailing characters."
  exit 1
fi

ENV_FILE="$ROOT/.env.local"
if [ -f "$ENV_FILE" ]; then
  warn ".env.local already exists at repo root."
  printf 'Overwrite it with the handoff values? [y/N] '
  read -r ANS
  case "$ANS" in
    y|Y|yes|YES) ;;
    *) err "Aborted. Left your existing .env.local untouched."; exit 1 ;;
  esac
fi

printf '%s\n' "$DECODED" > "$ENV_FILE"
ok "Wrote $ENV_FILE"

if printf '%s' "$DECODED" | grep -q 'YOUR-SERVICE-ROLE-KEY-HERE'; then
  echo
  warn "Heads up: this handoff did NOT include a service-role key or DB URL"
  warn "(the safe default). You can browse, play, and develop the web app"
  warn "against the shared database right away. If you later need to run puzzle"
  warn "ingest or apply migrations, stand up your own free Supabase project and"
  warn "fill those two values in — see CONTRIBUTING.md."
fi

echo
bold "==> Handing off to ./scripts/setup.sh"
exec "$SCRIPT_DIR/setup.sh"
