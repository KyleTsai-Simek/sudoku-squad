# TODO

Working task list. `[ ]` unstarted; `[~]` in progress; `[x]` done.

**How to use this file:** granular task list. Big decisions live in [DECISIONS.md](DECISIONS.md). Phase-level milestones in [ROADMAP.md](ROADMAP.md). Current snapshot in [STATUS.md](STATUS.md).

---

## Phase 0 — Setup ✅

Monorepo, doc set, Supabase migration 0001, GitHub repo, Vercel project. See git history for detail.

---

## Phase 1 — Single-player web ✅

Live at https://sudoku-squad-web.vercel.app/. Engine + UI + ingest + tests + CI + deploy all landed. See [STATUS.md](STATUS.md) for the full feature list.

### Phase 1 cleanup (parallelizable with Phase 2; not blocking)

- [ ] Mobile-responsive audit on iPhone SE width (375 px) and a larger phone (~420 px). The board uses clamp-based font sizing but needs an in-device pass.
- [ ] Favicon (SVG + 32 / 16 PNGs).
- [ ] Open Graph image + meta tags so the live URL unfurls nicely on iMessage, Slack, etc.
- [ ] Lighthouse pass; PWA-installable manifest.
- [ ] Migrate `apps/web` from `next lint` (deprecated) to the ESLint CLI before Next.js 16 removes the wrapper.
- [ ] Register `sudokusquad.com` and point at Vercel.
- [ ] Decide on Vercel preview environment vs. Supabase isolation (today previews hit prod Supabase — fine for V1, revisit before more users).
- [ ] Revisit expert tier when we have a high-difficulty puzzle source (3M dataset has ~100 rows >7.0, not enough for a 2 500-row sample).

---

## Phase 2 — Battle mode 🔄 Next

See [ROADMAP.md Phase 2](ROADMAP.md) for scope detail. Open questions to settle before this ships are tracked in [DECISIONS.md → Open questions](DECISIONS.md).

### Backend
- [ ] Edge Function `create_room({mode, difficulty}) -> {room_id, code}`. Picks a random unsolved-for-host puzzle of the chosen difficulty and writes `rooms.puzzle_code`. Generates a fresh 6-char base36 room code (retry on `unique(rooms.code)` conflict).
- [ ] Edge Function `join_room({code, username}) -> {room_id, player_id, color}`. Refuses joining a `playing` room in battle mode (mid-game join policy — needs confirmation, see DECISIONS open questions).
- [ ] Edge Function `submit_move({room_id, cell, kind, value})` — validates, assigns `seq`, inserts into `moves`, broadcasts on `room:{room_id}`.
- [ ] Edge Function `check_completion({room_id, player_id})` — server-side win check against `puzzles.solution`. Returns "win" / "not yet" without revealing which cells are wrong.
- [ ] Edge Function `hint({room_id, player_id, cell}) -> {value}` — multiplayer hint path. Replaces SP's `sp_get_puzzle` flow for the multiplayer context. Tracks hints used per-player (for the "X used a hint" indicator).
- [ ] Channel naming convention: `room:{room_id}`. One channel per room, three payload kinds (`move`, `presence`, `game_event`).

### `packages/core` — sync (new module)
- [ ] Supabase client factory (accepts injected client; web/RN each provide one).
- [ ] `useRoom(roomCode)` hook: subscribes, returns `room`, `players`, own board state, move sender.
- [ ] Optimistic move apply + server echo reconciliation (rollback on rejection).
- [ ] Move log replay on rejoin.
- [ ] Tests: types only initially, then a unit test for the reconciler.

### `apps/web` — battle UI
- [ ] Enable "New Battle" CTA on the home page (currently a disabled placeholder).
- [ ] Room route `/r/[code]`.
- [ ] Lobby state: player list, host's Start button, share link with copy button.
- [ ] Lobby settings panel (host-editable, locks at Start): show conflicts, auto-check, hints availability. Read-only for non-hosts.
- [ ] Mid-game join handling: battle = "this game has already started" screen with "Start a new one" option.
- [ ] In-game: own board + opponents' progress bars (sidebar or top strip).
- [ ] Battle winner overlay: announces winner, dismissible, losers can continue solving per [DECISIONS #0008](DECISIONS.md).
- [ ] Play-again flow (shows immediately for winner, after finish/quit for losers).
- [ ] Username picker (with localStorage remember-last).

### Testing
- [ ] Two-browser manual test: both join, both play, one finishes, winner declared correctly.
- [ ] Race-condition test: both submit a completing move within milliseconds — exactly one wins.
- [ ] Playwright two-context smoke (Phase 3 explicitly requires this for coop; nice to start the harness in Phase 2).

---

## Phase 3 — Coop mode

### Backend
- [ ] Extend `submit_move` for coop: shared board, LWW per cell by `seq`.
- [ ] Coop completion event triggers shared-win broadcast.
- [ ] Presence channel for cursors (throttled to ~10/s).

### `packages/core`
- [ ] LWW reducer for `value` moves (compare `seq`).
- [ ] Shared notes reducer: set-union via toggles, ordered by seq.
- [ ] Private notes state: per-cell, per-player, client-local (never sent to server).
- [ ] Presence helper (broadcast own cursor, listen for others).

### `apps/web` — coop UI
- [ ] Other players' cursor highlights with colored rings + username chip.
- [ ] Brief visual flash when someone else overwrites your cell.
- [ ] Private notes toggle near number pad.
- [ ] Visual distinction between shared and private notes when both exist in a cell.
- [ ] Shared completion celebration.
- [ ] Disconnect/reconnect grace UI (greyed cursor, "reconnecting…" badge).
- [ ] V1 descope plan: if private-notes mode is taking too long, ship coop with shared-only and move private notes to V2 ([DECISIONS #0007](DECISIONS.md)).

### Testing
- [ ] Two browsers, two players, complete a coop game.
- [ ] Two-tab Playwright smoke in CI ([DECISIONS #0013](DECISIONS.md)).
- [ ] Stress test: both clients spam the same cell — state converges.
- [ ] Network blip test: drop connection mid-game, rejoin, state intact.

---

## Phase 4 — iOS (React Native)

### Setup
- [ ] `apps/ios` scaffold with Expo (TypeScript template).
- [ ] Consume `packages/core` from the monorepo (no changes — if `core` needs platform code, that's a bug to fix in core's portability).
- [ ] Supabase RN client + anonymous auth.
- [ ] Deep linking for `/r/{code}` URLs.

### UI port
- [ ] Sudoku grid in RN (View + StyleSheet).
- [ ] Number pad in RN.
- [ ] Lobby + Settings sheets in RN.
- [ ] Navigation: React Navigation; screens Home, Lobby, Game, Result.

### Native polish
- [ ] Haptics on tap (`selectionAsync`) and completion (`notificationAsync.success`).
- [ ] Safe area + dynamic island handling.
- [ ] Software keyboard avoidance (custom number pad — no system keyboard).
- [ ] Dark mode.
- [ ] App icon + splash.

### Ship
- [ ] TestFlight build.
- [ ] Cross-play test: iOS + web in same room, both modes.
- [ ] App Store submission (screenshots, description, privacy policy).

---

## Continuous / cross-phase

- Keep `docs/STATUS.md` fresh whenever the project state shifts.
- Keep `docs/DECISIONS.md` updated for any non-trivial decision; resolve "Open questions" inline as they're decided.
- Keep this file trimmed.
- Telemetry/analytics: TBD (Plausible or PostHog after V1).
