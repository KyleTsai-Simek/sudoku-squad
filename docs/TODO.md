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

### `packages/core` — game engine (first focus)
- [ ] **Move reducer:** `applyMove(state: BoardState, move: Move): BoardState` — pure function, lives in `src/game/`. Handles `value`, `clear`, `note_toggle` move kinds. Refuses writes to given cells.
- [ ] Unit tests for the reducer covering each move kind + edge cases
- [ ] **Property tests** with `fast-check`: random valid move sequences preserve invariants. Specifically: no cell ever holds an invalid value; replaying a move log in seq order produces the same state as applying moves one-by-one; clearing a non-given cell always leaves `value=null`.
- [ ] Notes mask helpers: `setNote`, `clearNote`, `hasNote`, `notesToArray` for the bitmask `NotesMask` type
- [ ] Move history wrapper (for client-side undo) — keep separate from the reducer itself

### `scripts/ingest` — puzzle data
- [ ] Implement the Kaggle 9M CSV reader in `scripts/ingest/src/index.ts`
- [ ] Download dataset to `scripts/ingest/data/` (gitignored)
- [ ] For each candidate row: parse, run `hasUniqueSolution`, confirm dataset solution matches `solve()` output
- [ ] Sample 500–1000 medium-difficulty rows, upsert to Supabase `puzzles` via service-role client
- [ ] After ingest: re-run connectivity check — should now show non-zero rows and become a stronger RLS test
- [ ] Tighten `check-connectivity.ts` to verify anon canNOT read `puzzles.solution` even when rows exist (insert test row → query as anon → confirm empty result)

### `apps/web` — single player UI
- [ ] Replace placeholder home page with "New Game" CTA
- [ ] Game route `/play/[seed]?` — seed lets a player share a specific puzzle even in single-player
- [ ] Sudoku grid component (9×9, 3×3 box borders, selection highlight, row/col/box highlighting, same-value highlighting)
- [ ] Number pad component (1–9, clear, notes toggle, undo)
- [ ] Keyboard input handler (1–9 to enter, Backspace/0 to clear, N for notes mode, arrow keys to navigate)
- [ ] Conflict rendering (red tint on cells in conflict; only when "show conflicts" setting is on)
- [ ] Settings sheet (per-player in single-player; see GAME_DESIGN.md)
- [ ] Timer
- [ ] Completion celebration screen with "play again" CTA
- [ ] Mobile-responsive layout audit on iPhone SE width (375px) and a large phone (420px)

### Tooling & CI
- [ ] ESLint rule: ban DOM/Next/RN imports from `packages/core`
- [ ] ESLint rule: ban Norvig solver imports from `packages/core` (solver lives in `scripts/ingest`)
- [ ] Playwright config in `apps/web` + first happy-path smoke (load home page, render board, complete a puzzle)
- [ ] GitHub Actions CI: lint + typecheck + unit + property tests + Playwright on every PR

### Deploy
- [ ] Vercel project connected to GitHub `main`; first deploy succeeds
- [ ] Favicon + meta tags (open graph card with project name)
- [ ] Lighthouse pass: PWA-installable, good mobile score

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
