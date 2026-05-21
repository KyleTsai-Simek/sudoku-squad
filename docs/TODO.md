# TODO

Working task list. Checkboxes get checked as work completes. New items added as discovered. Older items pruned to keep this readable. Anything in `[ ]` is unstarted; `[~]` is in progress; `[x]` is done.

**How to use this file:** This is the *active* list. Big decisions get logged in [DECISIONS.md](DECISIONS.md). Phase-level milestones live in [ROADMAP.md](ROADMAP.md). This file is the granular grind.

---

## Phase 0 — Planning & setup (current)

- [x] Architecture decisions: Supabase, Next.js, RN, anonymous auth
- [x] Initial doc set (this folder)
- [x] Confirm name: Sudoku Squad
- [x] Per-room settings model decided
- [x] Battle-loser continue-after-win decided
- [x] Coop notes: shared default + private toggle decided
- [x] Puzzle dataset chosen: Kaggle 9M Sudoku
- [ ] Register domain (try sudokusquad.com first)
- [ ] Create Supabase project (dev + prod)
- [ ] Create Vercel project + connect GitHub repo
- [ ] Apple Developer account application (needed before Phase 4; ~1 week processing)

---

## Phase 1 — Single-player web

### Repo & tooling
- [x] Initialize pnpm workspace monorepo (root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`)
- [x] Scaffold `apps/web` (Next.js 15 App Router, React 19, TypeScript, Tailwind 3)
- [x] Scaffold `packages/core` (TS-only, no React UI) with Vitest + fast-check configured
- [x] Scaffold `scripts/ingest` with Norvig solver implementation
- [x] First Supabase migration (`supabase/migrations/0001_initial.sql`)
- [ ] User: `pnpm install` from repo root
- [ ] User: apply migration to Supabase (SQL editor or `supabase db push`)
- [ ] User: `pnpm dev` to verify the home page renders
- [ ] User: `pnpm --filter @sudoku-squad/core test` to verify tests run
- [ ] Set up ESLint rule banning DOM/Next/RN imports from `packages/core`
- [ ] Set up ESLint rule banning solver imports from `packages/core`
- [ ] Set up Playwright in `apps/web` for the first happy-path smoke test
- [ ] CI: lint + typecheck + unit + property tests + Playwright on every PR

### `packages/core` — game engine
- [ ] Types: `PuzzleId`, `CellIndex`, `CellValue`, `Notes`, `BoardState`, `Move`
- [ ] Puzzle loader (takes 81-int array of givens, returns initial `BoardState`)
- [ ] Validator: detect row/col/box conflicts (does NOT use solution)
- [ ] Completion checker (does the board match the solution?) — solution input separate from board
- [ ] Move reducer: `applyMove(state, move) -> state`
- [ ] Unit tests for all of the above (target ~90% coverage of core)
- [ ] **Property tests** with `fast-check`: random move sequences preserve invariants (no invalid cell values, replay-equivalence)

### `scripts/ingest` — dataset import (one-off)
- [ ] Download / load the Kaggle 9M Sudoku CSV
- [ ] Norvig-ported solver in TypeScript (~100 LoC)
- [ ] For each candidate row: parse, run solver, confirm exactly one solution, confirm it matches the dataset's claimed `solution`
- [ ] Pick 500–1000 medium-difficulty rows
- [ ] Upsert into Supabase `puzzles` table
- [ ] Document how to re-run if we want to expand the pool later

### `apps/web` — single player UI
- [ ] Home page with "New Game" CTA
- [ ] Game route `/play/[seed]?` (seed lets you share a specific puzzle even in single player)
- [ ] Sudoku grid component (9×9, 3×3 box borders, selection highlight)
- [ ] Number pad component (1–9, clear, notes toggle, undo)
- [ ] Keyboard input handler (1–9, arrow keys, N for notes, Backspace)
- [ ] Settings sheet (show conflicts, auto-check, hints availability)
- [ ] Timer
- [ ] Completion celebration screen
- [ ] Mobile-responsive layout audit on iPhone SE width

### Puzzle data
- [ ] Pick open-source dataset (candidates in [ARCHITECTURE.md §7](ARCHITECTURE.md))
- [ ] Write ingestion script: parse → validate uniqueness with solver → upsert into Supabase
- [ ] Seed ~200 medium-difficulty puzzles
- [ ] (Future) difficulty rating recomputation

### Deploy
- [ ] Vercel deploy from `main`
- [ ] Add a basic favicon + meta tags
- [ ] Lighthouse pass: PWA-installable, good mobile score

---

## Phase 2 — Battle mode

### Backend
- [ ] Supabase SQL migration: `puzzles`, `rooms`, `room_players`, `moves`
- [ ] RLS policies on all tables
- [ ] Enable anonymous auth in Supabase
- [ ] Edge Function: `create_room({mode, puzzle_id?}) -> {room_id, code}`
- [ ] Edge Function: `join_room({code, username}) -> {room_id, player_id, color}`
- [ ] Edge Function: `submit_move({room_id, cell, kind, value})` — validates + assigns seq + broadcasts
- [ ] Edge Function: `check_completion({room_id, player_id})` — server-side win check
- [ ] Channel naming convention: `room:{room_id}`

### `packages/core` — sync
- [ ] Supabase client factory (accepts injected client; web/RN provide it)
- [ ] `useRoom(roomId)` hook: subscribes, returns `room`, `players`, board state, move sender
- [ ] Optimistic move application + server echo reconciliation
- [ ] Move log replay on join

### `apps/web` — battle UI
- [ ] Home page: "New Battle" CTA
- [ ] Room route `/r/[code]`
- [ ] Lobby state: player list, host's Start button, share link with copy button
- [ ] **Lobby settings panel** (host-editable, locks at Start): auto-check, hints availability, show conflicts, etc.
- [ ] Read-only settings view for non-host players in the lobby
- [ ] Mid-game join handling: battle = "this game has already started" screen with option to start a new one
- [ ] In-game: own board + opponents' progress bars (sidebar or top strip)
- [ ] **Battle winner overlay**: announces winner, dismissible, losers can continue solving after dismissal
- [ ] Server-driven game-over UI (winner declared)
- [ ] Play-again flow (shows immediately for winner, after finish/quit for losers)

### Testing
- [ ] Two-browser manual test: both join, both play, one finishes, winner declared
- [ ] Race-condition test: both submit a completing move within milliseconds — only one wins

---

## Phase 3 — Coop mode

### Backend
- [ ] Extend `submit_move` to handle coop semantics (shared board, LWW per cell)
- [ ] Notes merge logic on server (or rely on client convergence — decide)
- [ ] Coop completion event triggers shared-win broadcast
- [ ] Presence channel for cursors (throttled to 10/s server-side rate limit)

### `packages/core`
- [ ] LWW reducer for `value` moves (compare `seq`)
- [ ] **Shared notes** reducer: set-union via toggles, ordered by seq
- [ ] **Private notes** state: per-cell, per-player, client-local (never sent to server)
- [ ] Presence helper (broadcast own cursor, listen for others)

### `apps/web` — coop UI
- [ ] Other players' cursor highlights with colored rings + username chip
- [ ] Visual indicator when someone else overwrites your cell (brief flash?)
- [ ] **Private notes toggle** near number pad — flips notes mode between shared and private
- [ ] Visual distinction between shared and private notes when both exist in a cell (e.g., shared notes in player colors, private notes in grey)
- [ ] Shared completion celebration (all players win)
- [ ] Disconnect/reconnect grace UI (greyed cursor, "reconnecting…" badge)
- [ ] **V1 descope plan:** if private-notes mode is taking too long, ship coop with shared-only and move private notes to V2. Per [DECISIONS.md #0007](DECISIONS.md).

### Testing
- [ ] Two browsers, two players, complete a coop game
- [ ] **Two-tab Playwright smoke test in CI** — opens two browser contexts in the same room, spams same-cell input, asserts state convergence. Runs on every PR.
- [ ] Stress test: both clients spam the same cell — does state converge?
- [ ] Network blip test: drop connection mid-game, rejoin, verify state

---

## Phase 4 — iOS (React Native)

### Setup
- [ ] `apps/ios` scaffold with Expo (TypeScript template)
- [ ] Configure to consume `packages/core` from the monorepo
- [ ] Supabase RN client + anonymous auth
- [ ] Deep linking for `/r/{code}` URLs

### UI port
- [ ] Sudoku grid in RN (View + StyleSheet)
- [ ] Number pad in RN
- [ ] Lobby screen in RN
- [ ] Settings sheet in RN
- [ ] Navigation: React Navigation, screens: Home, Lobby, Game, Result

### Native polish
- [ ] Haptics on tap (selectionAsync) and completion (notificationAsync success)
- [ ] Safe area + dynamic island handling
- [ ] Software keyboard avoidance (probably we don't show the system keyboard at all — number pad is custom)
- [ ] Dark mode
- [ ] App icon + splash

### Ship
- [ ] TestFlight build
- [ ] Cross-play test: iOS + web in same room, both modes
- [ ] App Store submission paperwork (screenshots, description, privacy policy)

---

## Continuous / cross-phase

- [ ] Keep `docs/DECISIONS.md` updated whenever a non-trivial decision is made
- [ ] Keep `docs/TODO.md` (this file) trimmed and current
- [ ] CI: lint + typecheck + tests on every PR
- [ ] Telemetry/analytics: TBD (probably Plausible or PostHog after V1)
