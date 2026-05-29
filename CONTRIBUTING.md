# Contributing to Sudoku Squad

Welcome. This is the human-facing guide to getting set up and landing changes. The
[CLAUDE.md](CLAUDE.md) file holds the same rules in more depth (it's written for AI
agents, but the architecture and verification sections apply to everyone) — this doc
points there rather than duplicating it.

## 1. Get set up

You'll need:

- **Node 22+** (`nvm install 22`)
- **pnpm 11** (`brew install pnpm`)
- **A Supabase project** — either ask to be added to the existing one, or stand up your
  own free project and apply the migrations (see below). You'll need its URL, anon key,
  service-role key, and Postgres connection string.

Then run the setup script from the repo root:

```bash
./scripts/setup.sh
```

It installs dependencies, scaffolds `.env.local` from `.env.example`, creates the
`apps/web/.env.local` symlink that Next.js needs, and runs the verification suite. If
`.env.local` is freshly created, fill in your real Supabase values and re-run the script.

Prefer to do it by hand? The same steps are spelled out in the
[README "Getting started"](README.md#getting-started) section.

Once setup passes:

```bash
pnpm dev        # http://localhost:3000
```

### Got a handoff blob from the owner?

If the project owner sent you a one-line **handoff blob**, you don't need to
hunt down Supabase values by hand. After cloning and `cd`-ing into the repo,
just run:

```bash
./scripts/onboard.sh '<paste the blob here>'
# or pipe it from the clipboard:  pbpaste | ./scripts/onboard.sh
```

That decodes the blob into `.env.local`, creates the Next.js symlink, installs
deps, and runs verification — the same as `setup.sh`, but pre-filled. The
default blob carries only the **public** Supabase values (URL + anon key), so
you can browse, play, and develop the web app against the shared database right
away. It does **not** include a service-role key or DB URL; if you later need
to run puzzle ingest or apply migrations, stand up your own free Supabase
project and fill those two values in (see [below](#connecting-a-fresh-supabase-project)).

### Owner: generating a handoff blob

To onboard someone cleanly, send them the GitHub invite plus a blob you
generate from your own machine:

```bash
./scripts/handoff.sh           # safe default — public anon values only
./scripts/handoff.sh --full    # ALSO shares service-role key + DB URL (trusted co-maintainers only)
```

`handoff.sh` reads your secrets from `.env.local` at the repo root — that
gitignored file **is** your secret store; that's where these values live and
where you'd go to rotate them. The safe-default blob is fine to send over
Slack/email because those values already ship in the web client bundle and are
guarded by Row-Level Security. Only use `--full` for someone you fully trust
with god-mode database access, and send that blob over a secure channel (a
password-manager share), never plaintext chat.

### Connecting a fresh Supabase project

If you're using your own project rather than the shared one, apply all migrations in
order:

```bash
brew install supabase/tap/supabase
supabase link --project-ref <your-ref>
supabase db push --linked
```

Migrations live in `supabase/migrations/` (`0001` through the latest). Puzzle ingest is
optional for most frontend work — see the
[README "Ingesting puzzles"](README.md#ingesting-puzzles) section if you need a populated
board.

## 2. Architectural rules (don't break these)

These keep the codebase coherent and the eventual iOS port painless. Full detail in
[CLAUDE.md §2](CLAUDE.md).

- **`packages/core` is platform-agnostic.** No imports from `next/*`, `react-dom/*`,
  `react-native/*`, or browser globals (`window`, `document`, `localStorage`). Platform
  capabilities are injected, not imported. Lint-enforced.
- **The server is authoritative for game-determining state.** Win/loss and "is this cell
  right" checks happen server-side. A puzzle's `solution` never ships to the client during
  multiplayer play.
- **Optimistic UI with reconciliation.** Apply local moves immediately, send to the
  server, reconcile on the echoed `seq`.
- **One Realtime channel per room** (`room:{room_id}`), three payload kinds: `move`,
  `presence`, `game_event`.
- **Extensionless internal imports** inside `packages/core` and `scripts/ingest`
  (`./foo`, not `./foo.js`).

## 3. Update the docs in the same change

This repo treats docs as part of the change, not a follow-up. If you ship something
meaningful, update the matching doc in the same PR. The mapping (which change touches
which doc) is the table in [CLAUDE.md §1](CLAUDE.md). At minimum:

- State of the project shifts → `docs/STATUS.md`
- Non-trivial design/stack choice → `docs/DECISIONS.md` (new entry at the top)
- Task done or added → `docs/TODO.md`

Stale docs are worse than no docs.

## 4. Verify before you call it done

Per [DECISIONS.md #0013](docs/DECISIONS.md):

- **`packages/core` changes:** run the Vitest suite; add unit tests, and property-based
  tests (`fast-check`) for anything stateful. `pnpm --filter @sudoku-squad/core test`
- **`apps/web` UI changes:** verify on both desktop and mobile widths; smoke-test the
  affected flow.
- **Sync changes:** the two-tab Playwright smoke must stay green.
- **Schema changes:** the migration must apply cleanly to a fresh DB.
- **Ingest changes:** every puzzle entering the table must be solver-verified for a unique
  solution.

Quick full sweep:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## 5. Git workflow

- Branch names: `feat/...`, `fix/...`, `chore/...` (e.g. `feat/phase3-coop-lock`).
- Commit messages in the present tense (`add coop lock`, not `added`).
- PRs reference the relevant `docs/TODO.md` item and update docs in the same PR.
- Never commit secrets. All `.env*` files except `.env.example` are gitignored.

## 6. When in doubt, ask

Architecture and UX decisions belong to the project owner — open an issue or ask before
building something that isn't in the current phase's scope (`docs/ROADMAP.md` /
`docs/TODO.md`). Naming, internal signatures, and behavior-preserving refactors are your
call.
