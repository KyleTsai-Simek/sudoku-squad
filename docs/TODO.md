# TODO

Working task list. Checkboxes get checked as work completes. New items added as discovered. Older items pruned to keep this readable. Anything in `[ ]` is unstarted; `[~]` is in progress; `[x]` is done.

**How to use this file:** Granular task list. Big decisions live in [DECISIONS.md](DECISIONS.md). Phase-level milestones in [ROADMAP.md](ROADMAP.md). Current snapshot in [STATUS.md](STATUS.md).

---

## Phase 0 — Setup ✅ COMPLETE

- [x] All architecture and game-design decisions captured in DECISIONS.md (entries 0001–0016)
- [x] Initial doc set: STATUS, GOALS_AND_SCOPE, ARCHITECTURE, GAME_DESIGN, ROADMAP, TODO, DECISIONS, CLAUDE
- [x] pnpm workspace monorepo scaffolded (`apps/`, `packages/`, `scripts/`)
- [x] `apps/web` scaffolded (Next.js 15, React 19, TypeScript, Tailwind 3) — home page renders, workspace import verified at runtime
- [x] `packages/core` scaffolded with types, board, validator, tests (6/6 passing)
- [x] `scripts/ingest` scaffolded with Norvig solver and tests (4/4 passing, including world-hardest puzzle)
- [x] First Supabase migration applied to live project (`puzzles`, `rooms`, `room_players`, `moves`, `puzzles_public` view, RLS policies)
- [x] Supabase project created, anonymous auth enabled
- [x] `.env.local` configured locally with Supabase credentials
- [x] Connectivity check passing (`pnpm --filter @sudoku-squad/ingest check`)
- [x] GitHub repo created and pushed: [`KyleTsai-Simek/sudoku-squad`](https://github.com/KyleTsai-Simek/sudoku-squad)

### Phase 0 deferred (not blocking Phase 1)
- [ ] Register domain (try `sudokusquad.com` first)
- [ ] Connect Vercel project to GitHub for auto-deploys
- [ ] Apple Developer account application (only needed before Phase 4; ~1 week processing)

---

## Phase 1 — Single-player web 🔄 ACTIVE

### `packages/core` — game engine ✅
- [x] **Move reducer:** `applyMove(state: BoardState, move: Move): BoardState` — pure function, lives in `src/game/`. Handles `value`, `clear`, `note_toggle` move kinds. Refuses writes to given cells.
- [x] Unit tests for the reducer covering each move kind + edge cases
- [x] **Property tests** with `fast-check`: random valid move sequences preserve invariants — no invalid value, replay == fold, given cells immutable, clear leaves `value=null`+`notes=0`, validator never flags an empty cell.
- [x] Notes mask helpers (`setNote`, `clearNote`, `toggleNote`, `hasNote`, `notesToArray`, `clearAllNotes`)
- [x] Move history wrapper (`applyMoveWithHistory`, `undo`, `redo`) — separate module from the reducer

### `scripts/ingest` — puzzle data
- [x] Sample puzzle pack bundled in `apps/web/lib/sample-puzzles.ts` (5 puzzles, solver-verified) — unblocks single-player UI until the real ingest lands. See [DECISIONS.md #0017](DECISIONS.md).
- [x] `verify-samples.ts` script + `pnpm verify:samples` — solver checks the bundled pack for uniqueness and matching solutions.
- [x] CSV streamer (`src/csv.ts`), bucketed sampler + solver-verified ingest in `src/index.ts`. Auto-detects header layout, buckets by `difficulty` column when present else by clue count, targets 2500 per tier (10000 total). `--dry-run` and `--csv <path>` flags for safe iteration. Repeatable fixture-based dry-run via `pnpm ingest:dry-fixture`.
- [x] Downloaded the Kaggle 3M CSV (`radcliffe/3-million-sudoku-puzzles-with-ratings`) to `scripts/ingest/data/sudoku-3m.csv`. Stored locally; gitignored.
- [x] Ran the ingest against the real dataset. 7500 rows in Supabase (2500 each easy/medium/hard, 0 expert by design).
- [x] Migration 0002 applied — `puzzles_public` is now a security-definer view (anon can read), `solution` still hidden.
- [x] `check-connectivity.ts` tightened: now asserts (a) anon reads `puzzles_public`, (b) anon's direct read of `puzzles` returns 0 rows despite 7500 existing, (c) anon cannot request `solution` from `puzzles_public`.
- [x] Swap `apps/web` single-player to fetch from Supabase. Home page lists by tier from `puzzles_public`, `/play/[code]` calls `sp_get_puzzle(code)` for the full row including solution. Bundled pack kept as offline fallback (smoke test uses it). Migration 0003 added the column, view, and RPC. Solved codes tracked in `localStorage`. Phase 2 will replace `sp_get_puzzle` for multiplayer with Edge Functions.
- [ ] Revisit expert tier when we have a high-difficulty source (the 3M dataset has only ~100 puzzles rated >7.0; insufficient for a 2500-row sample).

### `apps/web` — single player UI ✅ (modulo mobile audit)
- [x] Replace placeholder home page with "New Game" CTA + Quick Start grid (5 sample puzzles)
- [x] Game route `/play?seed=...` — seed lets a player share a specific puzzle even in single-player. Wrapped in `<Suspense>` for static prerendering.
- [x] Sudoku grid component (9×9, 3×3 box borders, selection highlight, row/col/box highlighting, same-value highlighting)
- [x] Number pad component (1–9, clear, notes toggle, undo, redo, hint)
- [x] Keyboard input handler (1–9 to enter, Backspace/0/Delete to clear, N for notes mode, arrow keys to navigate, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo)
- [x] Conflict rendering (red tint on cells in conflict; only when "show conflicts" setting is on)
- [x] Settings sheet (per-player in single-player; see GAME_DESIGN.md) — show conflicts, auto-check, highlight same value, auto-eliminate notes (placeholder for V2)
- [x] Timer (pauses on completion)
- [x] Completion celebration screen with "Play another" and "Back to menu" CTAs, showing elapsed time + hint count
- [ ] Mobile-responsive layout audit on iPhone SE width (375px) and a large phone (420px) — uses clamp-based font sizing already; needs in-device test

### Tooling & CI ✅
- [x] ESLint rule: ban DOM/Next/RN imports from `packages/core` (`packages/core/eslint.config.js` — `no-restricted-imports` + `no-restricted-globals`).
- [x] ESLint rule: ban Norvig solver imports from `packages/core` (`**/scripts/ingest/**` and `@sudoku-squad/ingest` both pattern-blocked, with a message pointing at DECISIONS #0012).
- [x] Playwright config in `apps/web` + first happy-path smoke (load home page, render board, complete a puzzle via the Hint button, assert overlay).
- [x] GitHub Actions CI: lint + typecheck + unit + property tests + sample/dry-run + Playwright on every PR and push to main (`.github/workflows/ci.yml`).
- [ ] Migrate `apps/web` from `next lint` to the ESLint CLI before Next.js 16 removes the wrapper (deprecation warning currently logged but build is green).

### Deploy
- [x] Vercel project connected to GitHub `main`; auto-deploys live at https://sudoku-squad-web.vercel.app/.
- [ ] Favicon + meta tags (open graph card with project name)
- [ ] Lighthouse pass: PWA-installable, good mobile score
- [ ] Register `sudokusquad.com` and point at Vercel
- [ ] Vercel + Supabase preview environment story (preview deployments today hit the *production* Supabase. Fine for V1 but worth thinking about before more users.)

---

## Phase 2 — Battle mode

### Backend
- [ ] Edge Function: `create_room({mode, puzzle_id?}) -> {room_id, code}`
- [ ] Edge Function: `join_room({code, username}) -> {room_id, player_id, color}`
- [ ] Edge Function: `submit_move({room_id, cell, kind, value})` — validates + assigns `seq` + broadcasts
- [ ] Edge Function: `check_completion({room_id, player_id})` — server-side win check against `puzzles.solution`
- [ ] Channel naming convention: `room:{room_id}` for all per-room realtime traffic

### `packages/core` — sync
- [ ] Supabase client factory (accepts injected client; web/RN each provide one)
- [ ] `useRoom(roomId)` hook: subscribes, returns `room`, `players`, board state, move sender
- [ ] Optimistic move application + server echo reconciliation (rollback on rejection)
- [ ] Move log replay on rejoin

### `apps/web` — battle UI
- [ ] Home page: "New Battle" CTA
- [ ] Room route `/r/[code]`
- [ ] Lobby state: player list, host's Start button, share link with copy button
- [ ] **Lobby settings panel** (host-editable, locks at Start): auto-check, hints availability, show conflicts. Read-only for non-hosts.
- [ ] Mid-game join handling: battle = "this game has already started" screen with "Start a new one" option
- [ ] In-game: own board + opponents' progress bars (sidebar or top strip)
- [ ] **Battle winner overlay**: announces winner, dismissible, losers can continue solving after dismissal
- [ ] Play-again flow (shows immediately for winner, after finish/quit for losers)

### Testing
- [ ] Two-browser manual test: both join, both play, one finishes, winner declared correctly
- [ ] Race-condition test: both submit a completing move within milliseconds — exactly one wins

---

## Phase 3 — Coop mode

### Backend
- [ ] Extend `submit_move` to handle coop semantics (shared board, LWW per cell by seq)
- [ ] Coop completion event triggers shared-win broadcast
- [ ] Presence channel for cursors (throttled to ~10/s)

### `packages/core`
- [ ] LWW reducer for `value` moves (compare `seq`)
- [ ] **Shared notes** reducer: set-union via toggles, ordered by seq
- [ ] **Private notes** state: per-cell, per-player, client-local (never sent to server)
- [ ] Presence helper (broadcast own cursor, listen for others)

### `apps/web` — coop UI
- [ ] Other players' cursor highlights with colored rings + username chip
- [ ] Brief visual flash when someone else overwrites your cell
- [ ] **Private notes toggle** near number pad — flips notes mode between shared and private
- [ ] Visual distinction between shared and private notes when both exist in a cell
- [ ] Shared completion celebration
- [ ] Disconnect/reconnect grace UI (greyed cursor, "reconnecting…" badge)
- [ ] **V1 descope plan:** if private-notes mode is taking too long, ship coop with shared-only and move private notes to V2. Per [DECISIONS.md #0007](DECISIONS.md).

### Testing
- [ ] Two browsers, two players, complete a coop game
- [ ] **Two-tab Playwright smoke test in CI** — both contexts in same room, spam same-cell input, assert state convergence. Runs on every PR. Per [DECISIONS.md #0013](DECISIONS.md).
- [ ] Stress test: both clients spam the same cell — state converges
- [ ] Network blip test: drop connection mid-game, rejoin, state intact

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
- [ ] Navigation: React Navigation; screens Home, Lobby, Game, Result

### Native polish
- [ ] Haptics on tap (selectionAsync) and completion (notificationAsync success)
- [ ] Safe area + dynamic island handling
- [ ] Software keyboard avoidance (we don't show the system keyboard — number pad is custom)
- [ ] Dark mode
- [ ] App icon + splash

### Ship
- [ ] TestFlight build
- [ ] Cross-play test: iOS + web in same room, both modes
- [ ] App Store submission (screenshots, description, privacy policy)

---

## Continuous / cross-phase

- Keep `docs/STATUS.md` fresh whenever the project state shifts.
- Keep `docs/DECISIONS.md` updated for any non-trivial decision.
- Keep this file trimmed — prune completed sub-bullets that no longer add signal.
- Telemetry/analytics: TBD (Plausible or PostHog after V1).
