# Roadmap

Four phases, each with an explicit **exit criterion** — we don't move on until it's met. Single player first, then battle, then coop, then iOS. This sequencing exists for a reason: each phase de-risks the next.

---

## Phase 1 — Single-player web

**Goal:** A solid, fun-to-use single player sudoku on the web. No multiplayer yet. This phase is mostly about getting the *game* right so we never have to relitigate it.

**Scope**
- Monorepo scaffolding (pnpm workspaces, Next.js app, `packages/core`).
- Puzzle dataset ingested (open-source pack, medium difficulty, ~200 puzzles to start).
- `packages/core`: puzzle types, validator, conflict checker, completion checker, basic move state machine.
- Web app: home page, "New game" button, full sudoku UI (grid + number pad + notes + undo + timer).
- Settings: show conflicts (on), auto-check (off), notes (on), hints (available).
- Mobile-responsive layout that works in a phone browser.
- Deployed to a real Vercel URL.

**Exit criterion**
- A user can play a complete game on web and mobile-web, the game is enjoyable, and `packages/core` has unit tests for puzzle validation, conflict detection, and completion.

**Estimate:** ~1–2 weeks of focused work.

---

## Phase 2 — Battle mode

**Goal:** Two players can race to finish the same puzzle via a shared link.

**Scope**
- Supabase project provisioned; SQL migrations for `puzzles`, `rooms`, `room_players`, `moves`.
- Anonymous auth wired up.
- Room creation flow: "New Battle" → creates room → `/r/{code}` → lobby.
- Username picker on first arrival to a room.
- Lobby UI: player list, host's "Start" button, share-link UI.
- Realtime channel: presence (who's online), `game_event` broadcasts, opponent progress %.
- Battle gameplay: each player has their own board, sees opponents' progress %.
- Server-side completion validation (Edge Function `check_completion` or RPC).
- "X won!" end-of-game UI; play-again button creates a fresh room.

**Exit criterion**
- Two browsers (one host, one joiner) can complete a full battle game end-to-end. Winner is declared correctly. No state desync.

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
