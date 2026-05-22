# Roadmap

Four phases, each with an explicit **exit criterion** — we don't move on until it's met. Single player first, then battle, then coop, then iOS. This sequencing exists for a reason: each phase de-risks the next.

**Current position:** end of Phase 1 → start of Phase 2 (battle mode). See [STATUS.md](STATUS.md) for the live snapshot.

| Phase | Status |
|---|---|
| Phase 0 — Setup, scaffold, doc set | ✅ Complete |
| Phase 1 — Single-player web | ✅ Complete (deployed at https://sudoku-squad-web.vercel.app/) |
| Phase 2 — Battle mode | 🔄 Next |
| Phase 3 — Coop mode | Pending |
| Phase 4 — iOS (React Native) | Pending |

---

## Phase 1 — Single-player web ✅

**Goal:** A solid, fun-to-use single-player sudoku on the web. **Exit criterion met.**

**What landed:**
- Monorepo (pnpm 11 workspaces, Next.js 15 app, `packages/core` with engine, `scripts/ingest`).
- 7 500 puzzles in Supabase (`radcliffe/3-million-sudoku-puzzles-with-ratings`), 2 500 each easy/medium/hard. Short 6-char codes assigned per puzzle.
- `packages/core`: types, validator, conflict checker, completion checker, pure move reducer, undo/redo history. 36/36 tests passing including `fast-check` property tests.
- Web app: home page with per-tier "New game" CTAs that pick a random unsolved puzzle and navigate to `/play/[code]`. Full sudoku UI (grid + number pad + notes + undo/redo + hint + timer + settings + completion overlay). Conflict highlighting, same-value highlighting, optional auto-check. Solved tracking in `localStorage`.
- Tooling: ESLint flat config enforces `packages/core` purity. Playwright happy-path smoke. GitHub Actions CI runs everything on PR + push.
- Deployed to https://sudoku-squad-web.vercel.app/, auto-deploys from `main`.

**Phase 1 cleanup (not blocking Phase 2):**
- Mobile audit on 375 px / ~420 px widths.
- Favicon + Open Graph metadata.
- Lighthouse / PWA manifest.
- `next lint` → ESLint CLI migration.
- Register `sudokusquad.com` and point at Vercel.

These are tracked in [TODO.md](TODO.md) and can be parallelized with Phase 2 work or batched into a polish pass.

---

## Phase 2 — Battle mode

**Goal:** Two players can race to finish the same puzzle via a shared link.

**Schema state going in:** `rooms`, `room_players`, `moves` already exist (migration 0001). `rooms.puzzle_code` references `puzzles(code)` (migration 0004). Anonymous auth enabled. No code change needed before Edge Functions can be added.

**Scope**
- Edge Functions in `supabase/functions/`:
  - `create_room({mode, difficulty})` — picks a random unsolved-for-host puzzle of the difficulty, returns `{room_id, code}`. Sets `rooms.puzzle_code`.
  - `join_room({code, username})` — returns `{room_id, player_id, color}`.
  - `submit_move({room_id, cell, kind, value})` — validates the move, assigns `seq`, persists in `moves`, broadcasts on the channel `room:{room_id}`.
  - `check_completion({room_id, player_id})` — server-side win check; never returns the solution.
  - `hint({room_id, player_id, cell})` — returns one cell's correct value (multiplayer hint, replaces the SP `sp_get_puzzle` flow).
- `packages/core/src/sync/`: created fresh.
  - Supabase client factory (accepts injected client; web and RN each provide one).
  - `useRoom(roomCode)` hook: subscribes, returns `room`, `players`, board state, move sender.
  - Optimistic move apply + server echo reconciliation (rollback on rejection).
  - Move log replay on rejoin.
- `apps/web`:
  - Home page: enable "New Battle" CTA (already a placeholder button).
  - Room route `/r/[code]`.
  - Lobby UI: player list, host's Start button, share link with copy button.
  - Lobby settings panel (host-editable, locks at Start): show conflicts, auto-check, hints availability.
  - Mid-game join handling: "this game has already started" screen with "Start a new one" option.
  - In-game battle UI: own board + opponents' progress bars.
  - Battle winner overlay (dismissible; losers may continue per [DECISIONS #0008](DECISIONS.md)).
  - Play-again flow.

**Exit criterion**
- Two browsers (one host, one joiner) can complete a full battle game end-to-end. Winner is declared correctly. No state desync.
- Race-condition test: both submit a completing move within milliseconds — exactly one wins.

**Estimate:** ~2 weeks.

---

## Phase 3 — Coop mode

**Goal:** Two players can collaboratively solve the same board.

**Scope**
- Coop room mode added to room creation flow.
- Shared board model: all moves apply to a single board.
- `moves` insertion via Edge Function that assigns `seq`, broadcasts on channel.
- Optimistic local apply + server reconciliation.
- Visible colored cursors via Supabase Presence (throttled).
- LWW conflict resolution per cell; merge logic for notes.
- Game completion celebrated together; play-again works.
- Disconnect/rejoin handling (60s grace).

**Exit criterion**
- Two browsers in the same coop room can fluidly co-solve a puzzle. Simultaneous typing into the same cell produces a deterministic result (LWW), and both clients converge. No state desync over 10+ minute sessions.

**Estimate:** ~2 weeks (more than battle because of conflict resolution + cursors).

---

## Phase 4 — iOS (React Native)

**Goal:** A native iOS app that plays cross-room with web players, sharing `packages/core`.

**Scope**
- Expo project at `apps/ios/`.
- Same `packages/core` imported (no changes — if there are changes, that's a bug we need to fix in core's portability).
- Supabase RN client wired up; anonymous auth works identically.
- Sudoku grid + number pad + room flows ported to RN components (no new logic).
- Haptics on tap / completion.
- iOS polish: safe area insets, software keyboard handling, dark mode, dynamic type basics.
- TestFlight build for ourselves and a few testers.
- App Store submission (or at least: ready-to-submit build).

**Exit criterion**
- An iOS user and a web user can join the same room and play a battle and a coop game to completion, with no observable difference in behavior.

**Estimate:** ~2–3 weeks once `packages/core` is stable.

---

## Stretch / V2 candidates

After Phase 4 lands, the natural next moves are:

1. **Difficulty tiers** (easy / medium / hard / expert) + difficulty selection in lobby.
2. **Daily puzzle** — same puzzle for everyone, leaderboard for the day.
3. **Persistent accounts** (Sign in with Apple + magic link) → profiles, history, stats.
4. **Match history & replays.**
5. **Friends list & private invites.**
6. **Android** (only if the iOS app gets traction).
7. **Real puzzle generator** so we're not dependent on a third-party dataset.

We don't commit to ordering yet — it depends on what users actually want after Phase 4.

---

## Risk register

Things that could derail the plan, ranked by likelihood × impact:

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Supabase Realtime latency feels bad on mobile networks | Medium | High | Prototype Phase 2 sync early; if it's bad, consider Partykit/Cloudflare DO. |
| Coop conflict resolution UX is annoying | Medium | Medium | Plan to user-test as soon as Phase 3 demo works; LWW + cursors should be enough. |
| Puzzle dataset has bad puzzles (no unique solution) | Low | High | Validate every puzzle on ingest with a solver — reject any with >1 solution. |
| React Native port reveals core had hidden web deps | Medium | Medium | CI lint rule on `packages/core` to ban `next/*`, `dom`, `window`, etc. |
| Cheating in battle (DevTools to see solution) | High if not addressed | Medium | Server-authoritative move validation; never ship `solution` to client. |
| Time sink on iOS polish | Medium | Medium | Budget an explicit polish sprint, don't try to perfect during dev. |
