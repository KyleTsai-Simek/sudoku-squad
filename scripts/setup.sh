#!/usr/bin/env bash
#
# One-shot local setup for Sudoku Squad.
# Idempotent — safe to re-run after you fill in .env.local.
#
#   ./scripts/setup.sh
#
set -euo pipefail

# Resolve repo root from this script's location, so it works from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
ok()   { printf '\033[32m%s\033[0m\n' "$1"; }

bold "==> Checking prerequisites"

if ! command -v node >/dev/null 2>&1; then
  warn "node not found. Install Node 22+ (nvm install 22) and re-run."
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  warn "node $(node -v) is too old; need >=20 (22 recommended)."
  exit 1
fi
ok "node $(node -v)"

if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm not found. Install pnpm 11 (brew install pnpm) and re-run."
  exit 1
fi
ok "pnpm $(pnpm -v)"

bold "==> Installing dependencies"
pnpm install

bold "==> Configuring environment"
ENV_CREATED=0
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  ENV_CREATED=1
  warn "Created .env.local from .env.example — you must fill in real Supabase values."
else
  ok ".env.local already exists"
fi

# Next.js reads .env.local from the app dir, not the repo root.
if [ -L apps/web/.env.local ] || [ -f apps/web/.env.local ]; then
  ok "apps/web/.env.local symlink already present"
else
  ln -s ../../.env.local apps/web/.env.local
  ok "Linked apps/web/.env.local -> ../../.env.local"
fi

if [ "$ENV_CREATED" -eq 1 ]; then
  echo
  warn "Next step: edit .env.local with your Supabase URL, anon key, service-role key,"
  warn "and DB URL, then re-run ./scripts/setup.sh to verify."
  exit 0
fi

bold "==> Verifying (core + ingest)"
pnpm --filter @sudoku-squad/core test
pnpm --filter @sudoku-squad/ingest test
# Connectivity check needs ingested puzzles; don't fail setup if it's empty.
pnpm --filter @sudoku-squad/ingest check || \
  warn "Connectivity check incomplete — usually means the puzzles table is empty (fine for browsing)."

echo
ok "Setup complete. Start the app with:  pnpm dev   (http://localhost:3000)"
