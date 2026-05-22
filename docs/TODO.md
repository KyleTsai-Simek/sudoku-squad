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

## Phase 2 — Battle mode 🔄 In progress

See [ROADMAP.md Phase 2](ROADMAP.md) for scope.

### Backend
- [x] Migrations 0005 (`pick_random_puzzle_code`), 0006 (RLS recursion fix via `is_room_member`), 0007 (Realtime publications).
- [x] Edge Function `create-room({mode, difficulty, username}) → {room_id, room_code, player_id, color, mode, puzzle_code}`.
- [x] Edge Function `join-room({code, username}) → {room_id, room_code, player_id, color, is_host, rejoined, ...}`. Enforces mid-game-join policy per [DECISIONS #0024](DECISIONS.md). Rejoin is idempotent.
- [x] Edge Function `start-game({room_id})` — host-only. Transitions room.status `lobby → playing`. Sets `started_at`. Realtime broadcast fires automatically via the rooms publication.
- [x] Edge Function `submit-move({room_id, cell, kind, value})` — validates, assigns next per-room `seq` (retries on unique-violation), inserts into `moves`, recomputes progress_pct, on progress=100 atomically transitions room → finished with winner. Server-side completion is fully inline; no separate `check-completion`.
- [ ] Edge Function `hint({room_id, player_id, cell}) → {value}` — multiplayer hint path. Counts toward visible "X used a hint" indicator in battle. Currently SP only has hint (via `sp_get_puzzle`); battle pad omits it.

### `packages/core` — sync (new module, lands in this phase)
- [~] **Deferred for V1.** The web client's `lib/battle-store.ts` does optimistic apply directly (no reconciler) and the server is authoritative — move rejection is rare enough that we don't roll back, just surface an error. When iOS lands or when coop's LWW forces the issue, lift this into `packages/core/src/sync/` with the reconciler design from ROADMAP.

### `apps/web` — battle UI
- [x] Home page sections: Solo / Battle a friend / Have a code? Battle CTAs call `create-room`, code input calls `join-room`.
- [x] `lib/supabase.ts` — `ensureAuthClient()` signs in anonymously and persists the session so refreshes preserve `auth.uid()`.
- [x] `lib/rooms.ts` — `createRoom`, `joinRoom`, `fetchRoomPlayers`, `subscribeToRoomPlayers` with typed errors.
- [x] `lib/username.ts` — localStorage-backed handle with random `adj-noun-NN` default.
- [x] `/r/[code]` lobby route: room code display, copy share link button, player list with realtime updates, rename (local), error states (not found / full / over / in progress).
- [x] Host "Start" button — wires up `start-game`. Disabled when < 2 players in battle.
- [x] Battle game view: own board (`BattleBoard`) + opponent progress bars (`OpponentProgress`) + own number pad (`BattleNumberPad`, hint omitted) + keyboard controller. Duplicates the SP components rather than refactoring them; revisit in Phase 3.
- [x] Server-broadcast Win overlay (announces winner; dismissible). Losers can dismiss but their board stays locked — full "keep solving" support is task #27.
- [ ] Lobby settings panel (host-editable, locks at Start): show conflicts, auto-check, hints availability.
- [ ] Play-again flow ("create a fresh room with the same players").
- [ ] Polish: losers can keep solving their own board after a winner is declared. Currently the board freezes when room.status='finished' broadcasts.

### Testing
- [ ] Two-browser manual test: both join, both play, one finishes, winner declared correctly.
- [ ] Race-condition test: both submit a completing move within milliseconds — exactly one wins.
- [ ] Playwright two-context smoke ([DECISIONS #0013](DECISIONS.md)) — the harness lands here so Phase 3 inherits it.

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
