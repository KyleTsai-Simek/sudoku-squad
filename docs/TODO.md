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
- [x] Expert tier shipped 2026-05-22. Re-bucketed the whole bank twice that day: first to `[0,1.5) / [1.5,4) / [4,5) / [5,7)` ([DECISIONS #0031](DECISIONS.md)), then narrowed easy to `[0, 0.75) / [0.75, 2.5) / [2.5, 5) / [5, 7)` ([#0032](DECISIONS.md)) when easy still felt too hard. 2,500 puzzles per tier, 10,000 total. A future "evil" tier (rating 7+) is still pending a richer source.
- [x] **warmup + beginner tiers** shipped 2026-05-22. Generated 5,000 naked-singles-only puzzles via QQWing, augmented to 29-40 clues. Ratings in [-10, 0). Migration 0012 extends `puzzles.difficulty` check constraint. See [DECISIONS #0033](DECISIONS.md).
- [x] **Shift-rename** 2026-05-22 ([#0034](DECISIONS.md)): beginner → easy → medium → hard → expert → killer. The five-button picker is now Warm-up / Easy / Medium / Hard / Expert; the former-expert tier survives as a hidden `killer` (no UI surface yet). Migration 0013 does the in-place rename + extends the check constraint.
- [x] **Kaggle → QQWing upper-tier regeneration** shipped 2026-05-29 ([#0042](DECISIONS.md)). Replaced the Kaggle-sourced medium/hard/expert/killer with QQWing technique-graded generation: medium=EASY, hard=INTERMEDIATE-1-technique, expert=INTERMEDIATE-≥2-techniques (both pure-logic), killer=EXPERT/requires-a-guess (revived). QQWing metadata stored as typed columns (migration 0016); migration 0017 cleared the old rows. Tool: `ingest:qqwing-graded`. The whole bank (15,000) is now QQWing-generated; the Kaggle pipeline + 3M dataset are dormant.

---

## Theme refresh + dark mode 🔄 Implemented and verified; user acceptance pending

Cross-cutting web UI project requested 2026-06-26. Working plan: [THEME_AND_DARK_MODE_PLAN.md](THEME_AND_DARK_MODE_PLAN.md). Design decision: [DECISIONS #0044](DECISIONS.md).

- [x] Confirm clean local tree before planning; `main` was even with `origin/main` and had no uncommitted changes.
- [x] Audit theme surface: hard-coded Tailwind utility colors in app/components, no semantic Tailwind palette, no CSS variables, fixed light body color, board-state color lookups in all three board components.
- [x] Capture implementation plan and open questions in docs.
- [x] Pick exact primary blue and extended semantic palette. User chose implementation-picked accessible default; web uses a blue centered on `#1d4ed8` / `#2563eb`.
- [x] Add Tailwind dark-mode + CSS variable theme infrastructure.
- [x] Add local `auto` / `light` / `dark` theme preference storage and system-preference listener.
- [x] Add the theme selector to the account UI.
- [x] Migrate home, lobby, game, overlays, sheets, controls, progress bars, and board states to semantic tokens.
- [x] Keep notes mode on a warm amber accent.
- [x] Verify lint/typecheck/build and affected Playwright smokes.
- [x] Manually verify desktop/mobile light and dark modes, focus states, board contrast, and settings override persistence.
- [ ] User manual confirmation should include `auto` behavior against the native system setting.
- [ ] User manual confirmation that the refreshed design is working and feels right.

---

## Phase 2 — Battle mode 🔄 Substantially landed (live)

See [ROADMAP.md Phase 2](ROADMAP.md) for scope. Remaining: two-context race-to-completion stress coverage; loser-keeps-solving is landed.

### Backend
- [x] Migrations 0005 (`pick_random_puzzle_code`), 0006 (RLS recursion fix via `is_room_member`), 0007 (Realtime publications).
- [x] Edge Function `create-room({mode, difficulty, username}) → {room_id, room_code, player_id, color, mode, puzzle_code}`.
- [x] Edge Function `join-room({code, username}) → {room_id, room_code, player_id, color, is_host, rejoined, ...}`. Enforces mid-game-join policy per [DECISIONS #0024](DECISIONS.md). Rejoin is idempotent.
- [x] Edge Function `start-game({room_id})` — host-only. Transitions room.status `lobby → playing`. Sets `started_at`. Realtime broadcast fires automatically via the rooms publication.
- [x] Edge Function `submit-move({room_id, cell, kind, value})` — validates, assigns next per-room `seq` (retries on unique-violation), inserts into `moves`, recomputes progress_pct, on progress=100 atomically transitions room → finished with winner. Server-side completion is fully inline; no separate `check-completion`.
- [x] **Hint removed for V1.** Per the May 22 product changes, the SP Hint button was dropped (Chunk A). The `sp_get_puzzle` RPC stays for auto-check. The multiplayer `hint` Edge Function is no longer planned.

### `packages/core` — sync (new module, lands in this phase)
- [~] **Sync rewrite landed 2026-05-23** ([DECISIONS #0036](DECISIONS.md)): atomic seq counter (`rooms.next_seq` + `reserve_room_seq` RPC), idempotency key (`moves.client_move_id`), parallel reads in `submit-move`, server-overlay coop store with `client_move_id` dedup + seq-sorted re-materialization, fail-resync on the client. Closes the same-cell divergence bug and implements the "if server rejects, roll back" rule (as resync).
- [~] **Batching + delivery-recovery follow-up 2026-05-23** ([DECISIONS #0037](DECISIONS.md)): client-side opportunistic batching via `move-batcher.ts` (per-room queue; first move flies immediately, subsequent ones flush in batches at the server's drain rate), server-side batch `submit-move` (`reserve_room_seqs` RPC, migration 0015, ONE atomic seq reservation + ONE batch insert + ONE materialize per batch up to 200 moves), seq-gap detection in coop store with debounced resync, realtime reconnect resync, tab-visibility resync. Closes the "moves trickle in slowly / some never arrive" complaint under burst typing on real two-device play.
- [ ] Still web-only — when iOS lands, lift the resync + overlay + batching logic into `packages/core/src/sync/` so RN can share it.

### `apps/web` — battle UI
- [x] Home page sections: Solo / Battle a friend / Have a code? Battle CTAs call `create-room`, code input calls `join-room`.
- [x] `lib/supabase.ts` — `ensureAuthClient()` signs in anonymously and persists the session so refreshes preserve `auth.uid()`.
- [x] `lib/rooms.ts` — `createRoom`, `joinRoom`, `fetchRoomPlayers`, `subscribeToRoomPlayers` with typed errors.
- [x] `lib/username.ts` — localStorage-backed handle with random `adj-noun-NN` default.
- [x] `/r/[code]` lobby route: room code display, copy share link button, player list with realtime updates, rename (local), error states (not found / full / over / in progress).
- [x] Host "Start" button — wires up `start-game`. Disabled when < 2 players in battle.
- [x] Battle game view: own board (`BattleBoard`) + opponent progress bars (`OpponentProgress`) + own number pad (`BattleNumberPad`, hint omitted) + keyboard controller. Duplicates the SP components rather than refactoring them; revisit in Phase 3.
- [x] Server-broadcast Win overlay (announces winner; dismissible). Losers can dismiss and keep solving their own board; late completions are recorded.
- [x] Lobby settings panel (host-editable, locks at Start): showConflicts / autoCheck / highlightSameValue + is_public — shipped in Chunk D (`LobbySettingsPanel` + `update-room-settings` Edge Function).
- [x] Play-again flow — shipped in Chunk H as the return-to-lobby same-room cycle (`return-to-lobby` Edge Function + `start-game` extended to reset + re-pick puzzle). Distinct from "fresh room with same players" but covers the same need.
- [x] Polish: losers can keep solving their own board after a winner is declared. Server already accepted late moves; lifted the local board lock in `battle-game.tsx` so `markFinished()` only fires when the local player IS the winner. The winner overlay's "Keep solving" button dismisses, the elapsed-time ticker keeps running, and when the late solver finishes (their own `submit-move` returns `won=true`), the overlay re-opens so they can pick Return-to-lobby or Back-to-menu. `canKeepSolving` now also gates on `finishedAt === null` so the dismiss button hides once they're done.

### Phase 2 UX expansion (May 22 product changes — chunks A–H) ✅

ADRs [#0026](DECISIONS.md)–[#0030](DECISIONS.md). Migrations 0008–0011. Edge Functions claim-username, update-room-settings, kick-player, return-to-lobby (+ create-room / start-game / submit-move extended). All landed and verified end-to-end on the live project.

### Phase 2 UX polish (May 22 afternoon pass) ✅

- [x] Board renders at integer pixel size at every viewport — `w-[calc(round(down,min(92vw,560px)-4px,9px)+4px)]` so each cell is exactly N px. Plus `border-stone-300` base color on every cell to kill Tailwind preflight gray-200 leak at corners.
- [x] Auto-clean peer notes: placing a value clears that digit from notes in same row / col / box. Always on; no setting. Undo restores. Implemented in `packages/core/src/game/reducer.ts` + `history.ts`; 6 new tests in core.
- [x] Keyboard shortcuts: `Space` toggles notes mode, `Shift+1-9` one-shot pencil-mark, `?` opens shortcut overlay. Header `?` button on desktop. Both SP and battle.
- [x] Notes button visual rework: pencil icon + accent-fill on state instead of "Notes off/on" text.

- [x] **Chunk A** — SP Hint button removed. Winner overlay: self → "You won!"; other → "[username] won". `canvas-confetti` fires on SP completion + battle winner overlay.
- [x] **Chunk B** — `apps/web/lib/data/usernames.csv` (456 adj × 966 noun) → `supabase/functions/_shared/word-lists.generated.json` via `pnpm build:wordlists`. New `claim-username` Edge Function + `issued_usernames` table (migration 0008). `lib/username.ts` is async, persists in localStorage, idempotent per `auth.uid()`.
- [x] **Chunk C** — Palette in `_shared/room-code.ts` is 8 distinct colors. `join-room` MAX_PLAYERS = 8. Lobby reads `(X/8)`.
- [x] **Chunk D** — `LobbySettingsPanel` (toggles for showConflicts / autoCheck / highlightSameValue + Public). New `update-room-settings` Edge Function. `submit-move` returns `cell_correct` when autoCheck is on. Battle-store tracks `incorrect` set.
- [x] **Chunk E** — Clients compute the 5-second countdown locally from `rooms.started_at`. Board visible with an overlay blocking input during countdown. Elapsed display starts at 0 after.
- [x] **Chunk F** — Migration 0009 + `record_completion` + `get_completion_count` RPCs. `submit-move` upserts on `won`. Home page shows username + total solved count. `lib/solved-tracker.ts` removed; `lib/completions.ts` replaces it.
- [x] **Chunk G** — Migration 0010 (`rooms.is_public`). `PublicLobbyList` on home page with Realtime auto-refresh. `kick-player` Edge Function. Lobby player rows show a kick button to host.
- [x] **Chunk H** — Migration 0011 (`room_players.has_returned`). `submit-move` flips all `has_returned=false` on the winning move + allows late finishes for losers (records their completion). New `return-to-lobby` Edge Function. `start-game` extended for replay: clears `moves`, picks a new puzzle of the same difficulty, resets progress/winner. Winner overlay's primary action is "Return to lobby"; non-returned players render with `opacity-60` + a 3-dot waiting animation; Start button disables with "Waiting on N players…".

### Phase 2 testing
- [x] Two-browser/local two-context smoke: both join, start, sync opponent progress, and recover battle state after a reload.
- [ ] Race-condition test: both submit a completing move within milliseconds — exactly one wins.
- [x] Playwright two-context smoke ([DECISIONS #0013](DECISIONS.md)) — `apps/web/e2e/battle.spec.ts` covers create + join + start + lobby→game routing + opponent-progress Realtime subscription, undo/redo progress sync, and mid-battle reload resume. Stops short of race-to-completion because full-board server drain is still slow. Extension tracked as a separate follow-up.

---

## Phase 3 — Coop mode 🔄 (MVP landed)

The coop MVP is live: shared board, server-overlay sync (LWW by `seq` + local pendings), atomic seq, opportunistic batching, resync triggers, and shared-win celebration. Sync logic lives in `apps/web/lib/coop-store.ts` + `move-batcher.ts` (server-overlay model), with the pure seq-log/board-diff helpers in `packages/core/src/sync/` + `packages/core/src/game/board-diff.ts`. Remaining: presence cursors, private notes, disconnect grace. A coop two-tab Playwright smoke now exists (local-only). See [DECISIONS #0036](DECISIONS.md)–[#0038](DECISIONS.md), [#0041](DECISIONS.md).

### Backend
- [x] Extend `submit_move` for coop: shared board, LWW per cell by `seq`. Atomic `reserve_room_seq` / `reserve_room_seqs` RPCs + `client_move_id` idempotency (migrations 0014/0015).
- [x] Coop completion event triggers shared-win broadcast (`shared_win`).
- [x] `change-mode` Edge Function backs the lobby battle↔coop toggle.
- [ ] Presence channel for cursors (throttled to ~10/s).

### Sync (`apps/web/lib/coop-store.ts`)
- [x] LWW for `value` moves by `seq` (server-overlay: `remoteBoard` from seq-sorted moves + local pendings).
- [x] Opportunistic move batching (`move-batcher.ts`, cap 200) + resync on seq-gap / reconnect / visibility.
- [x] Notes-faithful undo/redo/smart-clear ([#0041](DECISIONS.md)): undo emits a real move batch (`movesToReach` in core) so restored peer notes ride the log instead of diverging. Coop smart-clear brought to battle parity. Property-tested in core; guarded by the coop two-tab smoke.
- [ ] Shared notes reducer: set-union via toggles, ordered by seq.
- [ ] Private notes state: per-cell, per-player, client-local (never sent to server).
- [ ] Presence helper (broadcast own cursor, listen for others).

### `apps/web` — coop UI
- [x] Shared completion celebration.
- [x] Coop-colored shared progress in the lobby/game.
- [ ] Other players' cursor highlights with colored rings + username chip.
- [ ] Brief visual flash when someone else overwrites your cell.
- [ ] Private notes toggle near number pad.
- [ ] Visual distinction between shared and private notes when both exist in a cell.
- [ ] Disconnect/reconnect grace UI (greyed cursor, "reconnecting…" badge).
- [ ] V1 descope plan: if private-notes mode is taking too long, ship coop with shared-only and move private notes to V2 ([DECISIONS #0007](DECISIONS.md)).

### Testing
- [x] Coop two-context Playwright smoke (`e2e/coop.spec.ts`, local-only): create + join + start + shared-board sync, and the [#0041](DECISIONS.md) notes-undo regression guard (peer note restored on the other client after undo, verified via a full-log re-materialize on reload).
- [ ] Two browsers, two players, complete a coop game.
- [ ] Two-tab Playwright smoke in CI ([DECISIONS #0013](DECISIONS.md)) — coop/battle smokes still self-skip in CI (no Supabase env); wiring CI secrets is the remaining piece.
- [ ] Stress test: both clients spam the same cell — state converges.
- [ ] Network blip test: drop connection mid-game, rejoin, state intact.

---

## Phase 5 — Authenticated accounts 🔄 Built/deployed, e2e verification remaining

Optional email sign-in: portable progress + renameable usernames, anonymous stays the default. Full design in [DECISIONS #0043](DECISIONS.md), scope in [ROADMAP Phase 5](ROADMAP.md), detailed tracker in [SAVED_ACCOUNTS_PLAN.md](SAVED_ACCOUNTS_PLAN.md). Ordered roughly by dependency.

### Plan + tracking
- [x] Capture the saved-accounts implementation/testing plan in [SAVED_ACCOUNTS_PLAN.md](SAVED_ACCOUNTS_PLAN.md).
- [ ] Keep [SAVED_ACCOUNTS_PLAN.md](SAVED_ACCOUNTS_PLAN.md), this TODO, and [STATUS.md](STATUS.md) updated as milestones land.

### Backend — schema + config
- [x] Migration `0018` — mutable username table. Adds `base` + `discriminator` (int, nullable, `>= 1000` check) to `issued_usernames`; backfills `base` = old username; drops the old `unique(username)`; makes `username` a **generated** display column; unique index on `(lower(base), coalesce(discriminator, 0))`. **Live on the linked project.**
- [x] Migration `0019` — `get_completion_stats()` RPC (SECURITY DEFINER) returning the caller's per-difficulty solved counts. **Live on the linked project.**
- [~] **Supabase project config:** email provider enabled with Supabase's default **6-digit** OTP. Production magic-link sign-in is manually confirmed with token-hash callbacks; still explicitly confirm the Change email address template plus local/preview redirect allow-list. `supabase/config.toml` intentionally stays function-focused because the project runs against Supabase Cloud, not a local auth stack.

### Backend — Edge Functions
- [x] `set-username({ username })` — signed-in only (anon → `forbidden`). Validates base (3–20, `[A-Za-z0-9 _-]`); reads current holders, picks a bare base if free else a random discriminator from the smallest non-full width (`pickDiscriminator`); upserts the caller's row (frees the old tuple); retries on 23505. **Deployed.**
- [x] `merge-progress({ source_token })` — dest = caller JWT, source = body token. Guards source anonymous + ≠ dest + dest non-anon; upserts source `player_completions` onto dest (`ignoreDuplicates`), deletes source's username + completions, deletes the orphan anon user (best-effort). **Deployed.**
- [x] `claim-username` — inserts `base` (was `username`, now generated); anon defaults stay bare bases. **Deployed.**
- [x] Registered `set-username` + `merge-progress` in `config.toml`; added `getCaller` / `getUserFromToken` to `_shared/supabase.ts`.

### Client — auth
- [x] `lib/auth-store.ts` (Zustand) — `init`, `startEmailAuth` (link-in-place → fallback `signInWithOtp`, stashes anon token), `verifyCode` (type `email_change`/`email` + merge on existing-account path), `completeMagicLink`, `signOut` (re-anonymizes), `refreshUsername`. State: `userId`/`isAnonymous`/`email`/`username`/`awaitingCode`.
- [x] `lib/supabase.ts` — PKCE flow + `detectSessionInUrl: false` for manual callback handling.
- [x] `/auth/callback` route — exchanges `?code` (PKCE) or supported `?token_hash&type` links (`email`, `email_change`, `signup`, `magiclink`), runs merge from localStorage-mirrored pending state, redirects home. Supabase templates should prefer `token_hash&type` links because `?code` PKCE links fail if opened without the initiating browser's code verifier.

### Client — username
- [x] `lib/username.ts` — `setUsername(base)` (calls `set-username`, parses Edge error body), `clearCachedUsername()`. Removed the dead `setLocalUsernameOverride`. Display string comes straight from the server's generated `username`.

### Client — UI
- [x] `AppHeader` (hamburger, top-right) mounted in the root layout → shows on `/`, `/play`, `/r`. Material Symbols `menu` + `account_circle` inlined (`components/material-icons.tsx`). Boots the auth store.
- [x] Account item: signed-out → "Sign in"; signed-in → username + email → "Change username" / "Sign out".
- [x] `AuthSheet` — email → 6-digit code (Supabase default); magic link via `/auth/callback`.
- [x] `UsernameSheet` — base input, `name#1234` hint, shows the assigned full name on success.
- [x] Home "you're …" line now reads username from the auth store; solved count refetches on identity change.
- [x] Verified in preview: hamburger renders + opens, Account/Sign-in shows, auth sheet renders, no console errors, prod build clean (incl. `/auth/callback`).
- [x] Mobile header consolidation 2026-06-26: replaced the fixed top-corner hamburger with an in-flow `AppHeader` row on home, single-player, lobby, battle, and coop screens. Page header actions (Back/Menu, settings, keyboard shortcuts, account menu) now share one navigation bar; in-game elapsed time sits below the nav row.

### Testing
- [x] Unit: discriminator allocation (random, never-reuses, width-grows) + base validation + display string. Pure logic extracted to `packages/core/src/username/discriminator.ts` (10 tests, incl. a property test; core 72→82) and imported directly by the `set-username` Edge Function — single source of truth, no drift. The cross-boundary import bundles cleanly on `supabase functions deploy`.
- [x] Edge Function checks (post-deploy): `verify:accounts` covers Phase 5 columns, `get_completion_stats`, fresh anonymous sign-in, `claim-username`, anonymous `set-username` rejection, generated saved-account sessions, signed-in rename, collision → discriminator, rename frees old tuple, invalid/permanent-source merge rejection, and `merge-progress` union of anonymous completions.
- [~] Manual product checks: production token-hash magic-link sign-in and username change are confirmed. Still verify OTP-code entry, sign-out → fresh anon → sign back in, and cross-device progress union.
- [ ] E2E (local, needs Supabase + deploy + email OTP enabled + token-hash email templates): anon solve → sign in (new email) preserves count; second device (fresh anon progress) → sign in (same email) shows the **union**; rename collision; sign-out → fresh anon with account progress intact on re-sign-in.
- [x] Non-regression: anonymous-only play and local multiplayer smokes are green; `packages/core` purity lint is clean.

---

## Sync resilience hardening (from the 2026-05-29 architecture audit)

Findings from a full review of the SP / battle / coop sync paths benchmarked against comparable real-time games (downforacross, boardgame.io, Colyseus) and the Supabase Realtime delivery model, **plus the move-log consolidation discussion (2026-05-29).** Ordered by impact / cost. None require schema changes except where noted. See the audit writeup in this session and the prose in [STATUS.md](STATUS.md) gotchas.

Framing note (the move-log idea): the system is **already event-sourced** — the `moves` table is the durable append-only log and every client/server already re-materializes board state by replaying it. So the valuable upgrades are not "switch to a log" (we have one) but (b1) a **durable *local* log** for offline/crash/refresh recovery, and (b2) **delta catch-up** ("send me moves since seq N" + push my un-acked moves by `client_move_id`) replacing full-refetch resync. Keep incremental live push for peer-visibility and win-timing — the log is the durable substrate, not a replacement for the live channel. 1,000-move logs are a non-issue (~40–80 KB, sub-ms replay); only the full-replay-per-submit pattern is wasteful and delta catch-up removes it.

**Near-term:**
- [x] **(1, high impact) Room-level realtime recovery.** Landed 2026-05-29. `subscribeToRoom` / `subscribeToRoomPlayers` ([rooms.ts](../apps/web/lib/rooms.ts)) now take an `onReconnect` callback firing on every re-`SUBSCRIBED` (mirrors `subscribeToMoves`). [lobby-client.tsx](../apps/web/app/r/[code]/lobby-client.tsx) wires reconnect + `visibilitychange` refetch and an 8s safety-net poll while joined. Closes stranded-in-lobby / hidden-winner / frozen-opponent-progress on a silently-dropped channel — battle was fully exposed. Verified: battle two-context smoke green. (Recovery paths themselves aren't observable without fault injection; happy-path non-regression confirmed.)
- [x] **(3, correctness) Fix `hasSeqGap` false positives.** Landed 2026-05-29. [coop-store.ts](../apps/web/lib/coop-store.ts) now tracks `knownMissingSeqs`, recomputed from the authoritative snapshot on every `startCoop`/`resync`: a hole still present right after a full server fetch is an abandoned reservation (from submit-move's 23505 re-reserve path), not a dropped event, so the gap check ignores it. Self-healing — a seq falsely flagged (committed just after a SELECT snapshot) is dropped at the next resync. Kills the post-race resync storm.

**Consolidated durable-log track (do after near-term; the better form of old items #2/#4/#5):**
- [~] **(2 + b1) Durable local persistence + retry-with-backoff.** Retry half **landed 2026-05-29**: [move-batcher.ts](../apps/web/lib/move-batcher.ts) retries `internal` (5xx/network) submit failures up to 3× (250/600ms) before falling back to resync; deterministic rejections fail fast; idempotent via `client_move_id`. **Single-player persistence landed 2026-05-29**: [sp-persistence.ts](../apps/web/lib/sp-persistence.ts) snapshots the in-progress game to localStorage (one slot, keyed by puzzle code) and **auto-resumes on reload** (user decision: silent auto-resume; elapsed preserved with away-time frozen by rebasing `startedAt`). Cleared on completion. SP has no move log so this is a state snapshot, not a log. New `hydrate` action in `game-store.ts`; e2e regression in `e2e/sp-resume.spec.ts` (CI-safe, bundled sample). **Battle/coop refresh-resume landed 2026-05-29.** Earlier this was claimed "free" — it was only true for coop, whose `coop-game.tsx` fetches the full log on mount and `startCoop` materializes the board from it. Battle did **not**: `startBattle` built a board from givens only and `resyncFromServer` ran only on submit failure, so a mid-battle reload showed an empty grid; worse, `join-room` rejected the reloading player with `room_in_progress` before the rejoin check, bouncing them to an error screen. Fixed on both layers: (a) `join-room` now returns an existing member's seat **before** the new-joiner status gate (a refresh is a rejoin, not a new join — see [#0024](DECISIONS.md)); (b) `battle-game.tsx` init fetches `fetchOwnMoves` alongside givens and `startBattle` materializes the private board + `ownProgressPct` from that log (mirrors coop). Guarded by a new reload regression in `e2e/battle.spec.ts`. The only still-unpersisted state is the brief in-flight pending queue (moves typed in the ~sub-second window before their submit returns), lost on a hard refresh-mid-submit; persisting that (flush on reconnect, idempotent via `client_move_id`) is a small edge-case win, mainly for **Phase 4 mobile**. Not urgent.
- [x] **(b2) Delta catch-up reconciliation.** Landed 2026-05-29. Coop `resync` now fetches only `seq >= firstMissingSeq` (`fetchMovesSince` in [rooms.ts](../apps/web/lib/rooms.ts)) — the first real hole, or max+1 for a pure catch-up — and merges over what it holds, instead of re-reading the whole log. Removes the O(n²) full-replay cost and the resync storms; gap/reconnect/visibility triggers all route through it now. This is the literal form of the "if a player desyncs, the server catches up the differences" idea.
- [x] **(coop merge rule) Offline-merge policy — DECIDED.** Rule **(A)** pure LWW, persistence scoped to reconnect/refresh resume (not long concurrent-offline editing). See [DECISIONS #0040](DECISIONS.md). Escalate to fork-aware (C) only if true offline coop is ever needed — client-only, reversible.
- [~] **(5, portability) Lift sync logic into `packages/core/src/sync/`.** Started 2026-05-29: the pure seq-log helpers (`computeAbandonedHoles`, `firstMissingSeq`, `hasSeqGap`) are now in [`packages/core/src/sync/seq-log.ts`](../packages/core/src/sync/seq-log.ts) with 18 unit + property tests; coop-store imports them. **Remaining:** lift `materializeRemote` / `overlayPendings` / `computeOwnership` / the resync orchestration so web + iOS share the whole path. Downside: refactor cost.

**Deferred:**
- [ ] **(4, scaling) Migrate the `moves` channel from `postgres_changes` to Supabase Broadcast.** Single-threaded + per-subscriber RLS read per change — the scaling ceiling and the reason the hand-built resync triggers exist. Broadcast is the vendor-recommended game transport; keeps the seq-ordered LWW model intact. Highest-risk item (touches core sync path) — defer until approaching real concurrent load.

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
