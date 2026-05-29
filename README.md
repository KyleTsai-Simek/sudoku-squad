# Sudoku Squad

A multiplayer sudoku web app. Single-player + battle mode live; coop in flight.

- **Live demo:** https://sudoku-squad-web.vercel.app/
- **Modes:**
  - **Single player** — pick a tier, solve a random unsolved puzzle.
  - **Battle** — up to 8 players race to finish the same puzzle (live).
  - **Coop** — 2–8 players collaboratively solve one shared board (Phase 3, MVP landed: shared board, server-overlay sync, shared win).
- **Live features:** 15,000 puzzles across warm-up / easy / medium / hard / expert (plus a hidden killer tier), 2,500 each (the two easiest tiers generated locally via QQWing with negative ratings); auto-check; undo/redo with multi-cell undo; auto-clean peer notes; keyboard shortcuts (Space toggles notes, `?` shows overlay, Tab advances); persistent username + completion count; public lobbies; host kick; return-to-lobby replay cycle.

Inspired by Down for a Cross (multiplayer crosswords), Words With Friends, and the NYT Games apps.

---

## Status

**Phase 1 complete.** Single-player web is built and deployed. **Phase 2 (battle) is substantially landed** — chunks A–H from the May 22 product changes shipped plus a UX polish pass. **Phase 3 (coop) has an MVP landed** — shared board, server-overlay sync, atomic seq, shared win. Remaining: two-context Playwright smoke and the loser-keeps-solving local lock (battle); presence cursors, private notes, disconnect grace (coop). See [docs/STATUS.md](docs/STATUS.md) for the live snapshot.

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
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to set up, the rules to follow, how to verify and ship. |
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

Fastest path — the setup script installs deps, scaffolds `.env.local`, creates the
Next.js symlink, and runs verification:

```bash
git clone git@github.com:KyleTsai-Simek/sudoku-squad.git
cd sudoku-squad
./scripts/setup.sh        # fill in .env.local when prompted, then re-run
pnpm dev                  # http://localhost:3000
```

Onboarding a new collaborator? The owner can run `./scripts/handoff.sh` to emit
a one-line blob; the new user runs `./scripts/onboard.sh '<blob>'` to get a
ready-to-go `.env.local` in one step. See [CONTRIBUTING.md](CONTRIBUTING.md#got-a-handoff-blob-from-the-owner).

<details>
<summary>Or do it by hand</summary>

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
pnpm --filter @sudoku-squad/core test          # expect 47/47
pnpm --filter @sudoku-squad/ingest test        # expect 9/9
pnpm --filter @sudoku-squad/ingest check       # 4/4 if puzzles are ingested

# 4. Boot the web app
pnpm dev
# Visit http://localhost:3000
```

</details>

### Applying Supabase migrations

If you're connecting to a fresh Supabase project, apply all migrations in order:

```bash
# Install + link
brew install supabase/tap/supabase
supabase link --project-ref <your-ref>

# Push all
supabase db push --linked
```

Currently applied: `0001_initial.sql` through `0015_reserve_room_seqs_batch.sql` (fifteen migrations covering schema, RLS recursion fix, realtime publications, persistent usernames, completions, public lobbies, return-to-lobby, the easier/shifted difficulty tiers, and atomic per-room seq + batch reservation for coop sync).

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

# Real ingest (writes 10,000 rows via service-role key, across 4 Kaggle tiers:
# medium / hard / expert / killer, 2,500 each).
# Use --truncate to wipe puzzles + downstream tables first.
pnpm --filter @sudoku-squad/ingest ingest
pnpm --filter @sudoku-squad/ingest ingest -- --truncate

# Plus 5,000 additional easier puzzles via local QQWing generation
# (warmup + easy tiers, 2,500 each, ratings in [-10, 0)). ~60 minutes single-threaded.
pnpm --filter @sudoku-squad/ingest ingest:qqwing
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
    migrations/           # SQL migrations (0001..0015)
    functions/            # Edge Functions: create-room, join-room, start-game,
                          # submit-move, change-difficulty, change-mode,
                          # claim-username, kick-player, update-room-settings,
                          # return-to-lobby
  docs/                   # Planning + status docs
  .github/workflows/      # CI
```

## Workflow expectations

- **All meaningful changes update the relevant docs in the same PR.** See [CLAUDE.md](CLAUDE.md) §1 for the doc-update protocol.
- **`packages/core` is platform-agnostic.** No imports from `next/*`, `react-native/*`, `react-dom/*`, or browser globals. Lint-enforced via `packages/core/eslint.config.js`. See [CLAUDE.md](CLAUDE.md) §2.
- **Server is authoritative for game-determining state.** Win/loss in multiplayer happens server-side. `puzzles.solution` reaches the client only in single-player, via the `sp_get_puzzle` RPC ([DECISIONS.md #0022](docs/DECISIONS.md)).
- **Verification per [DECISIONS.md #0013](docs/DECISIONS.md):** property tests in core, two-tab Playwright smoke for sync (Phase 2), solver-verified dataset ingest.
