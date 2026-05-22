# Sudoku Squad

A multiplayer sudoku web app. Single-player live; battle + coop in flight.

- **Live demo:** https://sudoku-squad-web.vercel.app/
- **Modes (planned):**
  - **Battle** — 2–4 players race to finish the same puzzle.
  - **Coop** — 2–4 players collaboratively solve one shared board.
- **Phase 1 (live today):** Single-player sudoku with 7 500 puzzles in easy / medium / hard, hint, auto-check, undo/redo, settings, completion overlay. Per-device "don't re-serve solved puzzles" tracking via localStorage.

Inspired by Down for a Cross (multiplayer crosswords), Words With Friends, and the NYT Games apps.

---

## Status

**Phase 1 complete.** Single-player web is built, deployed to Vercel, talking to Supabase. **Phase 2 next: battle mode.** See [docs/STATUS.md](docs/STATUS.md) for the live snapshot.

## Document set (read in this order)

| Doc | Purpose |
|---|---|
| [docs/STATUS.md](docs/STATUS.md) | **Start here.** Current state, what's built, what's next, gotchas. |
| [docs/GOALS_AND_SCOPE.md](docs/GOALS_AND_SCOPE.md) | What we're building, what we're not, success criteria. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Tech stack, data model, identifiers across modes, web→iOS port plan. |
| [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) | Game modes, settings, UX decisions. |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phased plan from single player → battle → coop → iOS. |
| [docs/TODO.md](docs/TODO.md) | Active task list, broken out by phase. |
| [docs/DECISIONS.md](docs/DECISIONS.md) | ADR log + open questions. |
| [CLAUDE.md](CLAUDE.md) | Instructions for AI agents working in this repo. |

## Tech stack

- **Web:** Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 3
- **iOS (Phase 4):** React Native via Expo, sharing `packages/core`
- **Backend:** Supabase (Postgres + Realtime + Edge Functions)
- **Hosting:** Vercel (web) + Supabase Cloud
- **Auth:** Anonymous, with per-room usernames
- **Package manager:** pnpm 11 workspaces

## Getting started

### Prerequisites

- Node 22+ (`nvm install 22`)
- pnpm 11 (`brew install pnpm`)
- A Supabase project (see [docs/STATUS.md](docs/STATUS.md))

### Install and run

```bash
git clone git@github.com:KyleTsai-Simek/sudoku-squad.git
cd sudoku-squad
pnpm install

# 1. Fill in real Supabase values
cp .env.example .env.local
# Edit .env.local — NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#                   SUPABASE_SERVICE_ROLE_KEY (server-only — for ingest scripts)

# 2. Next.js reads .env.local from the app dir, not the repo root. Symlink it:
ln -s ../../.env.local apps/web/.env.local

# 3. Sanity-check the engine, solver, RLS
pnpm --filter @sudoku-squad/core test          # expect 36/36
pnpm --filter @sudoku-squad/ingest test        # expect 9/9
pnpm --filter @sudoku-squad/ingest check       # 4/4 if puzzles are ingested

# 4. Boot the web app
pnpm dev
# Visit http://localhost:3000
```

### Applying Supabase migrations

If you're connecting to a fresh Supabase project, apply all migrations in order:

```bash
# Install + link
brew install supabase/tap/supabase
supabase link --project-ref <your-ref>

# Push all
supabase db push --linked
```

Currently applied: `0001_initial.sql`, `0002_puzzles_public_security_definer.sql`, `0003_puzzle_code_and_sp_rpc.sql`, `0004_rooms_puzzle_code_fk.sql`.

### Ingesting puzzles

Empty `puzzles` table is fine for browsing-but-not-playing. To populate:

```bash
# Download the Kaggle 3M dataset (see scripts/ingest/README.md for kaggle CLI setup)
mkdir -p scripts/ingest/data
cd scripts/ingest/data
kaggle datasets download -d radcliffe/3-million-sudoku-puzzles-with-ratings
unzip 3-million-sudoku-puzzles-with-ratings.zip

# Dry-run first to inspect bucket counts
cd /Users/kylets/sudoku-squad
pnpm --filter @sudoku-squad/ingest ingest -- --dry-run

# Real ingest (writes ~7500 rows via service-role key)
pnpm --filter @sudoku-squad/ingest ingest
```

## Repo layout

```
sudoku-squad/
  apps/
    web/                  # Next.js web app (Phase 1 — live)
    ios/                  # React Native (Expo) — added in Phase 4
  packages/
    core/                 # Shared platform-agnostic game logic (TS only)
  scripts/
    ingest/               # Kaggle dataset ingest + Norvig solver (server-only)
  supabase/
    migrations/           # SQL migrations
    functions/            # Edge Functions (Phase 2 — none yet)
  docs/                   # Planning + status docs
  .github/workflows/      # CI
```

## Workflow expectations

- **All meaningful changes update the relevant docs in the same PR.** See [CLAUDE.md](CLAUDE.md) §1 for the doc-update protocol.
- **`packages/core` is platform-agnostic.** No imports from `next/*`, `react-native/*`, `react-dom/*`, or browser globals. Lint-enforced via `packages/core/eslint.config.js`. See [CLAUDE.md](CLAUDE.md) §2.
- **Server is authoritative for game-determining state.** Win/loss in multiplayer happens server-side. `puzzles.solution` reaches the client only in single-player, via the `sp_get_puzzle` RPC ([DECISIONS.md #0022](docs/DECISIONS.md)).
- **Verification per [DECISIONS.md #0013](docs/DECISIONS.md):** property tests in core, two-tab Playwright smoke for sync (Phase 2), solver-verified dataset ingest.
