# Roadmap

Four phases, each with an explicit **exit criterion** — we don't move on until it's met. Single player first, then battle, then coop, then iOS. This sequencing exists for a reason: each phase de-risks the next.

**Current position:** Phase 2 battle mode is playable end-to-end and live, with local Playwright coverage for sync, reload resume, and late joins plus loser-keeps-solving. Phase 3 coop has an MVP landed (shared board, server-overlay sync, shared win, late joins) with a local two-context notes-sync smoke. **Phase 5 (authenticated accounts) is built/deployed at the backend + client level and needs full email/merge/rename e2e verification before it is called complete** — see [DECISIONS #0043](DECISIONS.md) and [SAVED_ACCOUNTS_PLAN.md](SAVED_ACCOUNTS_PLAN.md). The cross-cutting theme refresh + dark mode pass is complete. See [STATUS.md](STATUS.md) for the live snapshot.

| Phase | Status |
|---|---|
| Phase 0 — Setup, scaffold, doc set | ✅ Complete |
| Phase 1 — Single-player web | ✅ Complete (deployed at https://sudoku-squad-web.vercel.app/) |
| Phase 2 — Battle mode | 🔄 Playable end-to-end; race-to-completion stress remains |
| Phase 3 — Coop mode | 🔄 MVP landed (shared board, server-overlay sync, shared win, local two-context smoke) |
| Phase 5 — Authenticated accounts | 🔄 Built/deployed; full email/merge/rename e2e verification remains |
| Cross-cutting — Completion leaderboard | 🔄 Implemented; migrations 0023/0024/0025 live, manual rename verification remains |
| Cross-cutting — End-game share links + OG images | 🔄 Implemented locally; deploy + external unfurl validation remain |
| Cross-cutting — Theme refresh + dark mode | ✅ Complete |
| Phase 4 — iOS (React Native) | Pending |

---

## Phase 1 — Single-player web ✅

**Goal:** A solid, fun-to-use single-player sudoku on the web. **Exit criterion met.**

**What landed:**
- Monorepo (pnpm 11 workspaces, Next.js 15 app, `packages/core` with engine, `scripts/ingest`).
- **15,000 puzzles** in Supabase across **six tiers, 2,500 each**, all QQWing-generated after [DECISIONS #0042](DECISIONS.md) and shifted in [#0047](DECISIONS.md): easy/medium use the original augmented naked-singles pipeline; hard/expert/extreme/killer use technique-graded QQWing metadata. `killer` is hidden from the UI. Short 6-char codes assigned per puzzle. See [DECISIONS #0033](DECISIONS.md), [#0034](DECISIONS.md), [#0042](DECISIONS.md), and [#0047](DECISIONS.md).
- `packages/core`: types, validator, conflict checker, completion checker, pure move reducer (with auto-clean peer notes), undo/redo history (multi-cell undo + `peekLastMove`), seq-log helpers, faithful board diffing, and username discriminator logic. **82/82 tests passing** including `fast-check` property tests.
- Web app: home page with per-tier "New game" CTAs that pick a random unsolved puzzle and navigate to `/play/[code]`. Full sudoku UI (grid + number pad + notes + undo/redo + timer + settings + completion overlay + keyboard shortcuts overlay). Hint was removed in Chunk A. Conflict highlighting, same-value highlighting, optional auto-check. Completions tracked server-side in `player_completions` (Chunk F).
- Tooling: ESLint flat config enforces `packages/core` purity. Playwright happy-path smoke. GitHub Actions CI runs everything on PR + push.
- Deployed to https://sudoku-squad-web.vercel.app/, auto-deploys from `main`.

**Phase 1 cleanup (not blocking Phase 2):**
- Mobile audit on 375 px / ~420 px widths.
- Favicon + Open Graph metadata.
- End-game share links with result-aware Open Graph images; implemented locally via signed `/s/{token}` routes. Deploy + external unfurl validation remain.
- Lighthouse / PWA manifest.
- `next lint` → ESLint CLI migration.
- Register `sudokusquad.com` and point at Vercel.

These are tracked in [TODO.md](TODO.md) and can be parallelized with Phase 2 work or batched into a polish pass.

---

## Phase 2 — Battle mode

**Goal:** Two players can race to finish the same puzzle via a shared link.

**Schema state going in:** `rooms`, `room_players`, `moves` already exist (migration 0001). `rooms.puzzle_code` references `puzzles(code)` (migration 0004). Anonymous auth enabled. No code change needed before Edge Functions can be added.

**Scope (final shape — what shipped)**
- Edge Functions in `supabase/functions/`:
  - `create-room`, `join-room`, `start-game`, `submit-move` — core flow. `submit-move` does inline progress + atomic winner update (subsumes the originally-planned `check_completion`).
  - `claim-username`, `update-room-settings`, `kick-player`, `return-to-lobby` — added in the May 22 UX expansion (Chunks B / D / G / H).
  - Multiplayer `hint` is **not** shipping — Chunk A removed the hint feature.
- `packages/core/src/sync/`: **deferred for V1.** The web client's `battle-store.ts` does optimistic local apply with the server as authority; move rejection is rare and we just surface an error rather than rolling back. The reconciler module lifts into `packages/core/src/sync/` when iOS lands or coop's LWW forces the issue.
- `apps/web`:
  - Home page: Solo / Battle / Public-lobby list / "Have a code?" sections, with private warmed rooms for Battle and Co-op so a multiplayer tap can route immediately when the background room is ready ([#0049](DECISIONS.md)).
  - Room route `/r/[code]`: lobby (live player list, share link, kick, host-edited settings panel) + battle game view (own board, opponent progress, synced countdown, winner overlay).
  - Late-join handling and the "return to lobby" same-room replay cycle (Chunk H, extended by [#0049](DECISIONS.md)); battle late joiners start behind on the timer, coop late joiners replay the shared board.
  - Persistent username (Chunk B), public lobbies (Chunk G), persistent completion count (Chunk F).

**Exit criterion**
- Two browsers (one host, one joiner) can complete a full battle game end-to-end. Winner is declared correctly. No state desync.
- Race-condition test: both submit a completing move within milliseconds — exactly one wins.

**Remaining work**
- Extend battle testing to a full race-to-completion + near-simultaneous final-move stress path (see Phase 2 Testing in [TODO.md](TODO.md)).

---

## Phase 3 — Coop mode 🔄 (MVP landed)

**Goal:** Players can collaboratively solve the same board.

**Scope**
- ✅ Coop room mode added to the room creation / lobby flow (mode toggle backed by `change-mode`).
- ✅ Shared board model: all moves apply to a single board.
- ✅ `moves` insertion via Edge Function that assigns atomic `seq`, broadcasts on channel.
- ✅ Optimistic local apply + server-overlay reconciliation (`coop-store.ts`, LWW by seq + local pendings); opportunistic batching; resync on seq-gap / reconnect / visibility.
- ✅ LWW conflict resolution per cell; coop undo emits a compensating move ([#0036](DECISIONS.md)).
- ✅ Game completion celebrated together (shared-win broadcast); play-again works.
- 🔲 Visible colored cursors via Supabase Presence (throttled).
- 🔲 Private/per-player notes merge logic.
- 🔲 Disconnect/rejoin grace handling.
- ✅ Two-context coop Playwright smoke (local-only; CI still skips live Supabase specs).

**Exit criterion**
- Two browsers in the same coop room can fluidly co-solve a puzzle. Simultaneous typing into the same cell produces a deterministic result (LWW), and both clients converge. No state desync over 10+ minute sessions.

**Estimate:** MVP landed; remaining polish is presence/private-notes/disconnect UX.

---

## Phase 5 — Authenticated accounts (pulled ahead of Phase 4)

**Goal:** Optional email sign-in so progress is portable across devices and usernames are changeable — *without* losing the "no signup required" feel. Anonymous play stays the default. Full design + rationale in [DECISIONS #0043](DECISIONS.md).

**Schema state going in:** anonymous auth + `auth.uid()`-keyed `room_players` / `moves` / `player_completions` already exist; usernames live in `issued_usernames` (globally-unique, immutable — [#0027](DECISIONS.md)). Progress already persists per device; this phase makes it portable and renameable.

**Scope**
- Keep anonymous sign-in as the default identity; add email **OTP** sign-in (magic link + 6-digit code) that *links* to the current anon user.
- First-time sign-in (new email): link in place → same `auth.uid()`, progress preserved automatically.
- Existing-account sign-in: `merge-progress` Edge Function unions the device's anon progress into the account (Supabase can't merge two user IDs).
- `set-username` Edge Function: signed-in renames with Discord-style `base#NNNN` discriminators (random, width-growing, freed on change-away). Anonymous users keep the immutable adj-noun handle.
- Backend stats capture only: `get_completion_stats()` RPC (per-difficulty + total); no stats screen this iteration.
- In-flow `AppHeader` navigation on all screens; Account item → "Sign in" / username → change-username + sign-out.
- ✅ Migrations `0018` (mutable username table: `base`/`discriminator` + uniqueness on `(lower(base), coalesce(discriminator,0))`) and `0019` (stats RPC) are live.
- ✅ Edge Functions `claim-username`, `set-username`, and `merge-progress` are deployed; basic anon smoke is green.
- ✅ Supabase project config is set for email OTP using the default 6-digit code, plus `/auth/callback` redirects.

**Exit criterion**
- A player solves puzzles anonymously on device A, signs in, then signs in on device B (fresh, with its own anon progress) — and device B shows the **union** of both devices' solved counts. Renaming to a taken base yields a `#NNNN` discriminator; changing away frees it. Sign-out drops to a fresh anonymous identity with progress intact under the account.
- No regression to anonymous-only play (the default path), and `packages/core` stays platform-agnostic.

**Estimate:** implementation is in place; budget remaining time for live e2e verification and fixes found there.

Detailed implementation/testing tracker: [SAVED_ACCOUNTS_PLAN.md](SAVED_ACCOUNTS_PLAN.md).

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

1. **A real "evil" / 7+ tier** once we have a richer high-difficulty source (the 3M dataset has only ~100 rows above rating 7.0 — not enough to seed a 2,500-row sample). Six tiers (easy/medium/hard/expert/extreme + hidden killer) already shipped in V1.
2. **Leaderboards beyond total completions** — the first global completion leaderboard is live ([DECISIONS #0048](DECISIONS.md)). Daily puzzle ranking/history can build on `player_daily_completions` ([#0046](DECISIONS.md)); per-difficulty and battle-win boards should extend the keyed read-model pattern.
3. ~~**Persistent accounts** (Sign in with Apple + magic link) → profiles, history, stats.~~ *Pulled forward as Phase 5* — email OTP accounts landing now ([DECISIONS #0043](DECISIONS.md)). Sign in with Apple, profiles/history UI, and richer leaderboard variants remain V2.
4. **Match history & replays.**
5. **Friends list & private invites.**
6. **Android** (only if the iOS app gets traction).
7. **Real puzzle generator** so we're not dependent on a third-party dataset.
8. **Coop "freeze the timer when nobody's present."** Today elapsed is wall-clock since `started_at`; freezing it requires presence tracking + accumulating *active* time instead, and changes the meaning of "elapsed" (matters for any future competitive/leaderboard time). Small feature, rides on the coop presence channel. Backlogged 2026-05-29 (see [DECISIONS #0040](DECISIONS.md) discussion).
9. **Coop "resume an in-progress room" UX.** The data layer already supports rejoining a persisted room and replaying its move log; this is the UI to surface "resume" instead of a cold join (and to handle a room that was `finished`/returned-to-lobby). Backlogged 2026-05-29.

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
