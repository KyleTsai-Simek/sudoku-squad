# Sudoku Squad

A multiplayer sudoku web app. Single-player, battle, and a coop MVP are live; optional accounts are in progress.

- **Live demo:** https://sudoku-squad-web.vercel.app/
- **Modes:**
  - **Single player** — pick a tier, solve a random unsolved puzzle.
  - **Battle** — up to 8 players race to finish the same puzzle (live).
  - **Coop** — 2–8 players collaboratively solve one shared board (Phase 3, MVP landed: shared board, server-overlay sync, shared win).
- **Live features:** 15,000 QQWing-generated puzzles across easy / medium / hard / expert / extreme (plus a hidden killer tier), 2,500 each; auto-check; undo/redo with multi-cell undo; auto-clean peer notes; keyboard shortcuts (Space toggles notes, `?` shows overlay, Tab advances); persistent username + completion count; public lobbies; host kick; return-to-lobby replay cycle; optional email account UI with username rename support.

Inspired by Down for a Cross (multiplayer crosswords), Words With Friends, and the NYT Games apps.

---

## Status

**Phase 1 complete.** Single-player web is built and deployed. **Phase 2 (battle) is playable end-to-end** — chunks A–H, loser-keeps-solving, battle reload resume, and local two-context Playwright coverage are landed. **Phase 3 (coop) has an MVP landed** — shared board, server-overlay sync, atomic seq, shared win, and a local two-context notes-sync smoke. **Phase 5 accounts are built/deployed at the backend + client level, with full email-link/merge/rename e2e verification still remaining.** See [docs/STATUS.md](docs/STATUS.md) for the live snapshot.

## Document set (read in this order)

| Doc | Purpose |
|---|---|
| [docs/STATUS.md](docs/STATUS.md) | **Start here.** Current state, what's built, what's next, gotchas. |
| [docs/GOALS_AND_SCOPE.md](docs/GOALS_AND_SCOPE.md) | What we're building, what we're not, success criteria. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Tech stack, data model, identifiers across modes, web→iOS port plan. |
| [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) | Game modes, settings, UX decisions. |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phased plan from single player → battle → coop → iOS. |
| [docs/TODO.md](docs/TODO.md) | Active task list, broken out by phase. |
| [docs/SAVED_ACCOUNTS_PLAN.md](docs/SAVED_ACCOUNTS_PLAN.md) | Phase 5 saved-accounts implementation and verification tracker. |
| [docs/DECISIONS.md](docs/DECISIONS.md) | ADR log + open questions. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to set up, the rules to follow, how to verify and ship. |
| [AGENTS.md](AGENTS.md) | Current repo instructions for AI coding agents. |
| [CLAUDE.md](CLAUDE.md) | Instructions for AI agents working in this repo. |

## Tech stack

- **Web:** Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 3
- **iOS (Phase 4):** React Native via Expo, sharing `packages/core`
- **Backend:** Supabase (Postgres + Realtime + Edge Functions)
- **Hosting:** Vercel (web) + Supabase Cloud
- **Auth:** Anonymous by default, with optional email OTP accounts and renameable usernames
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
pnpm --filter @sudoku-squad/core test          # expect 82/82
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

Currently applied to the linked project: `0001_initial.sql` through `0021_fix_daily_puzzles_rpc_ambiguity.sql`. Migration `0022_shift_difficulty_labels_to_extreme.sql` is present locally and should be pushed with the difficulty-label release.

### Ingesting puzzles

Empty `puzzles` table is fine for browsing-but-not-playing. To populate:

```bash
# Dry-run the legacy fixture first to sanity-check the solver/code path
cd /Users/kylets/sudoku-squad
pnpm --filter @sudoku-squad/ingest ingest:dry-fixture

# Generate the two easiest QQWing tiers (easy + medium).
pnpm --filter @sudoku-squad/ingest ingest:qqwing

# Generate the upper QQWing technique-graded tiers
# (hard / expert / extreme / hidden killer, 2,500 each).
pnpm --filter @sudoku-squad/ingest ingest:qqwing-graded
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
    ingest/               # QQWing/legacy dataset ingest + Norvig solver (server-only)
  supabase/
    migrations/           # SQL migrations (0001..0019)
    functions/            # Edge Functions: create-room, join-room, start-game,
                          # submit-move, change-difficulty, change-mode,
                          # claim-username, kick-player, update-room-settings,
                          # return-to-lobby
  docs/                   # Planning + status docs
  .github/workflows/      # CI
```

## Workflow expectations

- **All meaningful changes update the relevant docs in the same PR.** See [AGENTS.md](AGENTS.md) §1 for the doc-update protocol.
- **`packages/core` is platform-agnostic.** No imports from `next/*`, `react-native/*`, `react-dom/*`, or browser globals. Lint-enforced via `packages/core/eslint.config.js`. See [AGENTS.md](AGENTS.md) §2.
- **Server is authoritative for game-determining state.** Win/loss in multiplayer happens server-side. `puzzles.solution` reaches the client only in single-player, via the `sp_get_puzzle` RPC ([DECISIONS.md #0022](docs/DECISIONS.md)).
- **Verification per [DECISIONS.md #0013](docs/DECISIONS.md):** property tests in core, two-tab Playwright smoke for sync (Phase 2), solver-verified dataset ingest.
