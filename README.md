# Sudoku Squad

A multiplayer sudoku web app with two modes:

- **Collaborative** — two or more players work the same puzzle together from different devices.
- **Battle** — two or more players race to finish the same puzzle.

Inspired by Down for a Cross (multiplayer crosswords), Words With Friends, and the NYT Games apps.

---

## Status

**End of Phase 0** — repo scaffolded, Supabase migration applied, dev server runs, all tests pass.
**Next:** Phase 1 (single-player web). See [docs/STATUS.md](docs/STATUS.md) for the live snapshot.

## Document set (read in this order)

| Doc | Purpose |
|---|---|
| [docs/STATUS.md](docs/STATUS.md) | **Start here.** Current state, what's built, what's next, gotchas. |
| [docs/GOALS_AND_SCOPE.md](docs/GOALS_AND_SCOPE.md) | What we're building, what we're not, success criteria. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Tech stack, data model, realtime sync model, web→iOS port plan. |
| [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) | Game modes, settings, UX decisions (resolved and open). |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phased plan from single player → battle → coop → iOS. |
| [docs/TODO.md](docs/TODO.md) | Active task list, broken out by area. |
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

- Node 22+ (`nvm install 22` or via Homebrew)
- pnpm 11 (`brew install pnpm`)
- A Supabase project (see [docs/STATUS.md](docs/STATUS.md) — Kyle already has one set up)

### Install and run

```bash
git clone git@github.com:KyleTsai-Simek/sudoku-squad.git
cd sudoku-squad
pnpm install

# Copy the env template and fill in real Supabase values
cp .env.example .env.local
# Edit .env.local — NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

# Sanity-check the engine, solver, and Supabase connectivity
pnpm --filter @sudoku-squad/core test
pnpm --filter @sudoku-squad/ingest test
pnpm --filter @sudoku-squad/ingest check

# Boot the web app
pnpm dev
# Visit http://localhost:3000
```

### Applying the Supabase migration

If you're connecting to a fresh Supabase project, apply [supabase/migrations/0001_initial.sql](supabase/migrations/0001_initial.sql) before running the connectivity check:

- Supabase dashboard → SQL Editor → New query → paste the file contents → Run.
- Or use the Supabase CLI: `brew install supabase/tap/supabase && supabase link --project-ref <ref> && supabase db push`.

## Repo layout

```
sudoku-squad/
  apps/
    web/                  # Next.js web app
    ios/                  # React Native (Expo) — added in Phase 4
  packages/
    core/                 # Shared platform-agnostic game logic + sync (TS only)
  scripts/
    ingest/               # Kaggle dataset ingest + Norvig solver (server-only)
  supabase/
    migrations/           # SQL migrations
    functions/            # Edge Functions (Phase 2)
  docs/                   # Planning + status docs
```

## Workflow expectations

- **All meaningful changes update the relevant docs in the same PR.** See [CLAUDE.md](CLAUDE.md) §1 for the doc-update protocol.
- **`packages/core` is platform-agnostic.** No imports from `next/*`, `react-native/*`, `react-dom/*`, or browser globals. See [CLAUDE.md](CLAUDE.md) §2.
- **Server is authoritative.** Win/loss and any "is this right" check happens server-side. `puzzles.solution` never reaches the client.
- **Verification per [DECISIONS.md #0013](docs/DECISIONS.md):** property tests in core, two-tab Playwright smoke for sync, solver-verified dataset ingest.
