# Sudoku Squad

A multiplayer sudoku web app with two modes:

- **Collaborative** — two or more players work the same puzzle together from different devices.
- **Battle** — two or more players race to finish the same puzzle.

Inspired by Down for a Cross (multiplayer crosswords), Words With Friends, and the NYT Games apps.

---

## Status

Planning phase. No code yet — see the docs below for direction.

## Document set

| Doc | Purpose |
|---|---|
| [docs/GOALS_AND_SCOPE.md](docs/GOALS_AND_SCOPE.md) | What we're building, what we're not, success criteria. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Tech stack, data model, realtime sync model, web→iOS port plan. |
| [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) | Game modes, settings, UX decisions (open and closed). |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phased plan from single player → battle → coop → iOS. |
| [docs/TODO.md](docs/TODO.md) | Active task list, broken out by area. |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Lightweight decision log + open questions. |
| [CLAUDE.md](CLAUDE.md) | Instructions for AI agents working in this repo. |

## Tech stack (V1)

- **Web client:** Next.js (React, TypeScript)
- **iOS client (later):** React Native via Expo, sharing a TypeScript core package with web
- **Backend:** Supabase (Postgres + Realtime + Edge Functions)
- **Hosting:** Vercel (web) + Supabase Cloud
- **Auth:** Anonymous + chosen username (no account required for V1)

## Getting started

Code does not yet exist. Once the V1 scaffolding lands, this section will document setup:

```bash
# Coming soon
pnpm install
pnpm dev
```

## Repo layout (planned)

```
sudoku-squad/
  apps/
    web/            # Next.js web app
    ios/            # React Native (Expo) app — added in Phase 4
  packages/
    core/           # Shared game logic, types, sync helpers
    ui/             # (Optional) shared UI primitives
  supabase/
    migrations/     # SQL migrations
    functions/      # Edge Functions
  docs/             # Planning docs (this folder)
```
