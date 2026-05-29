#!/usr/bin/env bash
#
# Generate a copy/paste handoff blob for a new collaborator.
#
#   ./scripts/handoff.sh            # safe default: public Supabase values only
#   ./scripts/handoff.sh --full     # ALSO shares the service-role key + DB URL
#
# Reads your secrets from .env.local (repo root — gitignored, this is your
# "secret file"). Emits a single base64 line you paste to the new user, who
# runs ./scripts/onboard.sh on their side to get going.
#
# By default ONLY the two NEXT_PUBLIC_* values travel. Those already ship in
# the web client bundle and are guarded by Row-Level Security, so sharing them
# is safe. The service-role key (god-mode, bypasses RLS) and the DB URL (holds
# your Postgres password) are withheld unless you explicitly pass --full.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
ok()   { printf '\033[32m%s\033[0m\n' "$1"; }
err()  { printf '\033[31m%s\033[0m\n' "$1" >&2; }

ENV_FILE="$ROOT/.env.local"
if [ ! -f "$ENV_FILE" ]; then
  err "No .env.local found at repo root. Run ./scripts/setup.sh and fill it in first."
  exit 1
fi

FULL=0
if [ "${1:-}" = "--full" ]; then
  FULL=1
elif [ -n "${1:-}" ]; then
  err "Unknown argument: $1   (use no args, or --full)"
  exit 1
fi

# Pull a single VALUE for KEY=VALUE from .env.local (first match wins).
read_env() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }

URL="$(read_env NEXT_PUBLIC_SUPABASE_URL)"
ANON="$(read_env NEXT_PUBLIC_SUPABASE_ANON_KEY)"
SERVICE_ROLE="$(read_env SUPABASE_SERVICE_ROLE_KEY)"
DB_URL="$(read_env SUPABASE_DB_URL)"

if [ -z "$URL" ] || [ "$URL" = "https://YOUR-PROJECT-REF.supabase.co" ]; then
  err "NEXT_PUBLIC_SUPABASE_URL is empty or still the placeholder. Fill in .env.local first."
  exit 1
fi
if [ -z "$ANON" ] || [ "$ANON" = "YOUR-ANON-KEY-HERE" ]; then
  err "NEXT_PUBLIC_SUPABASE_ANON_KEY is empty or still the placeholder. Fill in .env.local first."
  exit 1
fi

PLACEHOLDER_SR="YOUR-SERVICE-ROLE-KEY-HERE"
PLACEHOLDER_DB="postgresql://postgres:YOUR-PASSWORD@db.YOUR-PROJECT-REF.supabase.co:5432/postgres"

if [ "$FULL" -eq 1 ]; then
  echo
  warn "================================ DANGER ================================"
  warn " --full shares your SERVICE-ROLE KEY and DB URL."
  warn " These bypass Row-Level Security and grant full read/write to your DB,"
  warn " including the ability to read every puzzle's solution. Only share with"
  warn " a fully-trusted co-maintainer who needs to run ingest or migrations."
  warn " For anyone else, re-run WITHOUT --full (they get their own project for"
  warn " ingest)."
  warn "======================================================================="
  printf 'Type SHARE to continue: '
  read -r CONFIRM
  if [ "$CONFIRM" != "SHARE" ]; then
    err "Aborted. Nothing was emitted."
    exit 1
  fi
  OUT_SR="$SERVICE_ROLE"
  OUT_DB="$DB_URL"
  SCOPE="FULL (includes service-role key + DB URL)"
else
  OUT_SR="$PLACEHOLDER_SR"
  OUT_DB="$PLACEHOLDER_DB"
  SCOPE="safe (public anon values only)"
fi

# The decoded payload is a complete .env.local body. Non-shared secrets carry
# their placeholder so the new user's file matches .env.example and they know
# exactly what to fill in if they later need ingest/migrations.
PAYLOAD="$(cat <<EOF
# Provisioned via scripts/handoff.sh ($SCOPE)
# .env.local is gitignored — never commit this file.

# Supabase
NEXT_PUBLIC_SUPABASE_URL=$URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$OUT_SR

# Supabase Postgres connection string (used by ingest scripts and migrations)
SUPABASE_DB_URL=$OUT_DB
EOF
)"

BLOB="$(printf '%s' "$PAYLOAD" | openssl base64 -A)"

echo
bold "Handoff blob ready — scope: $SCOPE"
echo
echo "Send the new collaborator BOTH of these:"
echo
bold "  1. The GitHub repo invite (so they can clone)."
bold "  2. These two commands to run after cloning + cd into the repo:"
echo
echo "-------------------------------------------------------------------------"
echo "./scripts/onboard.sh '$BLOB'"
echo "-------------------------------------------------------------------------"
echo
if [ "$FULL" -eq 0 ]; then
  ok "This blob is safe to send over Slack/email — it carries only the public,"
  ok "RLS-guarded anon values. The new user can browse, play, and develop"
  ok "against the shared DB immediately. If they need to run ingest/migrations,"
  ok "they stand up their own Supabase project (see CONTRIBUTING.md)."
else
  warn "This blob contains LIVE SECRETS. Send it only over a secure channel"
  warn "(e.g. a password manager share or 1Password), never plaintext chat."
fi
echo
echo "Your own secrets live in:  $ENV_FILE  (gitignored)."
