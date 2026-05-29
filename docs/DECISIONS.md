# Decisions

A lightweight Architecture Decision Record. Each decision has: context, the choice, alternatives, and consequences. Add new entries at the **top** (newest first). Don't edit old entries — supersede them with a new one.

Format:

```
## NNNN — Title
**Date:** YYYY-MM-DD
**Status:** Accepted | Superseded by #MMMM | Open

**Context.** Why we needed to decide.
**Decision.** What we picked.
**Alternatives considered.** Briefly, and why we passed.
**Consequences.** What follows.
```

---

## 0040 — Durable local move log + delta catch-up, and the coop offline-merge rule
**Date:** 2026-05-29
**Status:** Accepted. **Merge rule = (A)** — pure LWW-by-arrival-seq, with client persistence scoped to *reconnect/refresh resume*, not long concurrent-offline editing (chosen by the user 2026-05-29). **Landed:** retry-with-backoff (`move-batcher.ts`), delta catch-up resync (coop), and the pure seq-log helpers lifted into `packages/core/src/sync/` with property tests. **Still pending:** durable local-log *persistence* (b1) and finishing the core extraction (materialize / overlay / ownership / resync orchestration). The coop "freeze timer when empty" and "resume-an-in-progress-room UX" ideas raised in this discussion are backlogged to [ROADMAP.md](ROADMAP.md) Stretch/V2 #8–#9.

**Clarification (offline-resume vs concurrent-offline-merge).** A room already persists fully in Postgres (`rooms` + `moves`); there is no in-memory server room to "spin up" and Realtime channels are ephemeral, so rejoining a room URL later and replaying the log already works. (A) therefore *does* support leave-and-resume — it only declines to *merge concurrent overlapping edits made while one player was offline*, which is a niche case for a live co-op puzzle. If true offline coop ever matters, escalate to rule (C) (fork-aware), a client-only, reversible change.

**Context.** The 2026-05-29 architecture audit (see [STATUS.md](STATUS.md) gotcha #9, [TODO.md](TODO.md) "Sync resilience hardening") confirmed the system is *already event-sourced* — the `moves` table is the durable append-only log and every client/server re-materializes board state by replaying it. The remaining resilience wins are therefore not "adopt a log" but two upgrades on top of the log we have:
1. **Durable *local* log.** Client pendings live in memory only, so a refresh or crash loses unsynced moves, and single-player has *no* persistence at all (a reload loses the whole game). Persisting the local move log (IndexedDB on web, AsyncStorage on iOS) unlocks offline play and crash/refresh resume.
2. **Delta catch-up.** Today "desync → resync" refetches the *entire* log. Replacing that with "give me moves since seq N" + "here are my un-acked moves (by `client_move_id`)" is incremental, removes the O(n²) full-replay-per-submit cost, and matches how downforacross/Colyseus recover. Retry-with-backoff (landed 2026-05-29 in `move-batcher.ts`) is the transient-failure slice of this and is already done.

Incremental live push stays — the log is the durable substrate, **not** a replacement for the live channel. Peers need timely updates, and a board-completing move must still flush immediately so win-timing isn't delayed by batching. Scale is a non-issue: a 1,000-move log is ~40–80 KB and replays sub-millisecond.

**The open sub-question (needs a user call).** Single-player and battle have private boards, so a durable local log + offline accumulation is conflict-free — purely beneficial. **Coop is not free.** Under the current last-write-wins-by-server-`seq` rule ([#0036](DECISIONS.md), [#0038](DECISIONS.md)), the server stamps a seq at *arrival*. A coop player who accumulates moves offline and syncs a stale batch later gets *fresh* (high) seqs for *old* intentions, so their 5-minute-old "I filled this cell" can clobber a teammate's 10-second-old correction. We need a deliberate rule before persisting coop offline edits.

Candidate merge rules:
- **(A) Pure LWW-by-arrival-seq (status quo, do nothing).** Simplest; offline batch wins everything it touches. Acceptable if we forbid coop *offline* edits (only persist for crash/refresh-while-online resume, flush on reconnect within the 2-min grace [#0025](DECISIONS.md)). Recommended default — it sidesteps the conflict by scoping persistence to short reconnects, not true offline sessions.
- **(B) Timestamp-aware merge.** Stamp each move with a client `created_at`; on apply, a move doesn't overwrite a cell whose current value was set by a *later* timestamp. Needs a trusted-ish clock and a tiebreak; more correct for genuine offline but adds complexity and a clock-skew surface.
- **(C) Fork-aware ("don't clobber what changed since you forked").** Record the seq the client was last synced at; an offline move skips (or flags) a cell that any higher-seq move has touched since. Closest to human intent, most code.

**Decision (direction, pending the sub-question).** Build the durable local log + delta catch-up. Lift the consolidated sync logic into `packages/core/src/sync/` so web + iOS share it ([#0036](DECISIONS.md) deferred this; do it here). For coop, **default to (A) with persistence scoped to reconnect-resume rather than long offline sessions** unless the user wants true offline coop, in which case (C) is the recommended rule.

**Alternatives considered.** *Whole-log push instead of incremental* — rejected: we already have the server log, peers need live updates, and win-timing can't wait for a batch. *Skip persistence, just keep retry* — leaves SP with no resume and mobile fragile; retry alone doesn't survive a refresh/crash.

**Consequences.** SP and battle gain offline/resume for free. Coop gains crash/refresh resume immediately; true-offline coop waits on the merge-rule choice. New client-storage code path to test on web and (later) RN. No schema change for (A); (B)/(C) add a per-move client timestamp / last-synced-seq but both are client-derivable and don't change the server's authority.

---

## 0039 — Battle undo/redo emit server-side compensating moves
**Date:** 2026-05-29
**Status:** Accepted

**Context.** Battle progress (`progress_pct`) is the server-authoritative count of filled non-given cells over total empties — no correctness check, so the solution never leaks ([#0022](DECISIONS.md)). The typed-entry and Clear paths (`enterValue`, `clearCell`) submit a move and reconcile `ownProgressPct` from the echo, so they track clear-then-refill correctly. But undo/redo were deliberately local-only ([#0036](DECISIONS.md)): they mutated the local board without submitting anything. That left two defects — the player's own bar showed a stale % until the next typed move, and the server's move log never learned of the revert, so opponents (and the win check) kept counting cells the player had emptied via undo.

**Decision.** Battle undo/redo now emit a server-side compensating move, exactly as coop already does ([#0036](DECISIONS.md)): undo restores the prior visible state (`clear`, a re-place to the prior value, or a self-inverse `note_toggle`); redo re-submits the redone move. The result is reconciled through the same path as a typed entry — `ownProgressPct`, autocheck `incorrect` flags, and `won`→`finishedAt` all update from the echo (`submitCompensating` in `battle-store.ts`). Notes still don't count toward progress (the server ignores `note_toggle` when materializing), but the toggle is still logged so a resync replays faithfully.

**Alternatives considered.**
- *Keep undo local-only and just patch `ownProgressPct` locally.* Fixes the own-bar staleness but not the authoritative drift — the server would still over-count emptied cells, so opponents' view and the win check stay wrong. Rejected.
- *Recompute the local board diff and emit moves for every changed cell.* A `value`/`clear` undo only ever changes its own cell's value (peer-note restoration doesn't affect progress), so the single-cell compensating move from `top.priors` is sufficient and matches the coop implementation.

**Consequences.** Undo/redo are now async and go over the network like any move; on failure they resync from the server (`fetchOwnMoves`) like the other battle paths. The two-tab battle smoke now asserts fill→undo→redo moves the own progress bar 0→>0→0→>0. Supersedes the "battle undo stays local-only" note in [#0036](DECISIONS.md).

---

## 0038 — Coop progress: per-player credit by last-placer (regardless of correctness)
**Date:** 2026-05-23
**Status:** Accepted

**Context.** The first coop UI shipped a single team-colored progress bar — useful for "how close are we?" but not for "who did what?". The user asked to make per-player contribution visible: stacked colored segments inside the bar, with names colored above. We needed an unambiguous rule for *which* player owns a given cell at any moment.

**Decision.** Ownership rule: the credit for a cell goes to whichever player *last placed a value* in that cell, **regardless of correctness**. Concretely:
- `value` move sets ownership to that move's `player_id` (last-writer-wins by seq).
- `clear` removes ownership entirely.
- `note_toggle` does not change ownership.
- Overwriting a peer's wrong value transfers credit to the overwriter (and bumps the team % if the overwritten cell was previously empty — though overwrite of an existing value keeps the count the same and just shifts the segment from one color to another).
- Sum of all per-player credit counts equals the team's filled-cell count, which matches the server-authoritative `progress_pct` (off by at most ±1 pp from integer rounding).

Ownership is computed at *render* time from `serverMoves + pendings + ownPlayerId` (the new exported `computeOwnership` helper in `coop-store.ts`). Storing it would have required updating it on every store mutation; render-time derivation is cheap (81 cells, single pass) and means a fresh pending move shows up in the bar the instant it's placed — no waiting for the realtime echo.

**Alternatives considered.**
- *Credit only correct cells.* Simpler to compute (replay through the solution-checker) but punishes guesswork that's often part of solving — the user wanted credit for trying.
- *Credit by first-placer (not last).* Stable for an individual cell but loses the "I cleaned up your bad guess" signal. Last-placer is what mirrors human intuition of "this is my answer right now."
- *Store ownership in the Zustand state.* More straightforward read but every move-path mutation has to recompute and `set()` again; we already saw a delivery-lag bug where ownership trailed pendings until the realtime echo arrived. Render-time computation eliminates that class of bug entirely.

**Consequences.** No schema change — the rule is fully derivable from the existing `moves` table. The displayed bar is per-cell-fill, not per-cell-correctness, which means progress can fall back to zero if a player clears cells (matches the existing `sharedProgressPct` semantics — `filled / total_empty`). Future fairness extensions (e.g. "wrong placements don't count" mode) would just need a new derivation pass over `moves`, not a schema change.

---

## 0037 — Batched submit-move + resync triggers (gap detection, reconnect, visibility)
**Date:** 2026-05-23
**Status:** Accepted (extends [#0036](#0036))

**Context.** Shortly after #0036 landed, real two-device coop play surfaced a throughput problem the previous rewrite hadn't solved: when one player types fast, the second device sees moves trickle in slowly and a small fraction never arrive at all. The sync model is correct, but the *delivery pipeline* per move is heavy:

- Every keystroke is a separate `submit-move` HTTP call (~250 ms warm).
- The server's `reserve_room_seq` UPDATE serializes concurrent submits from the same caller on the same room row.
- Each insert fires its own `postgres_changes` event, and Supabase's logical-replication delivery has documented backpressure under bursts — events *can* be dropped under buffer pressure.
- There's no recovery mechanism for dropped events; today's only resync trigger is a submit failure.

A 20-move burst from one player took ~5 s wall-clock to land on the server and arrived at the second device with a noticeable trickle. Sometimes one or two moves never showed up at all until the next legitimate move from someone landed (and the realtime broadcast happened to deliver after a buffer flush).

**Decision.** Two related changes:

1. **Batched `submit-move`.** The Edge Function accepts either the legacy single-move shape or a new `{room_id, moves: [...]}` array shape. For an array:
   - Reserve N consecutive seqs in one round-trip via a new `reserve_room_seqs(room_id, count)` RPC (migration 0015).
   - Insert all N moves in one batch insert.
   - Materialize the board once at the end.
   - Return `{ results: [{seq, cell_correct?, idempotent?}, ...], progress_pct, won, is_winner }`.

   Idempotency is per-move (each move can carry its own `client_move_id`); on a (room_id, client_move_id) conflict the function falls through with the prior seq for that one move and re-reserves seqs for the truly fresh ones. Batch capped at 200 moves both client and server-side.

2. **Client opportunistic batching queue.** A new module `apps/web/lib/move-batcher.ts` holds a per-room queue. First move fires immediately as a one-element batch (no artificial delay for solo moves); while that request is in flight, subsequent moves accumulate; on response, queued moves flush together as one batched call. Under sustained fast typing, batches grow until they match the server's drain rate. Both battle-store and coop-store route through `enqueueMove(roomId, move)` instead of calling `submitMove` directly.

Plus three small resync triggers on the coop client, since postgres_changes is not a perfectly reliable delivery channel:

3. **Seq-gap detection.** After every `applyRemoteMove`, the store checks whether `serverMoves` has holes in its seq sequence (e.g., we have 1, 2, 4 but not 3). If so, schedule a debounced refetch 500 ms later; cancel the schedule if a subsequent event fills the hole first. Catches the "dropped event" case described above.
4. **Realtime reconnect.** `subscribeToMoves` now takes an optional `onReconnect` callback fired when the channel transitions to `SUBSCRIBED` after a prior subscription (i.e., on recovery from a transient WebSocket drop). Coop wires this to `resync()`. Without this, a network blip leaves the client missing every event that happened during the offline window.
5. **Tab visibility.** `coop-game.tsx` listens for `visibilitychange` and calls `resync()` when the tab returns to visible. Browsers throttle WebSockets in background tabs; without this, switching tabs causes silent state divergence.

**Alternatives considered.**
- **Time-based batch flush (e.g., 30 ms debounce on every move).** Simpler, but adds latency to every solo move including the first. Rejected — opportunistic is strictly better: solo moves stay instant, only bursts batch.
- **Switch from `postgres_changes` to a `broadcast` channel.** Supabase Realtime broadcast channels skip the DB replication path (lower latency). Considered, but: (a) it would require the Edge Function to also `channel.send()` each move (another network call + auth hop), (b) broadcast isn't durable so we'd still need `postgres_changes` for replay-on-reconnect, (c) the batching change already collapses 20 events into 1 batch's worth of inserts, which is the bigger lever. Revisit if measured latency is still bad after #0037 lands.
- **Periodic heartbeat resync (every 30 s).** Catches drops by brute force. Rejected — burns bandwidth on every client even when idle, papers over bugs we'd rather find, and would have masked the very divergence bug #0036 fixed. The targeted gap/reconnect/visibility triggers cover the same failure modes without the noise.
- **Larger client-side queue with explicit "flush" UI.** Too much complexity for V1; opportunistic batching is already imperceptible.

**Consequences.**
- A 20-move burst from one client now lands as ONE HTTP request and ONE atomic seq-batch reservation (vs. 20 of each). Other clients still receive 20 realtime events (postgres_changes fires per-row insert), but they all fire within the same ~200-300 ms window rather than over ~5 s.
- The seq column can have small gaps (already true after #0036 from idempotency races; the batch path now also produces gaps on the 23505 re-insert path, where the original reserved range gets partially abandoned). This is fine — seq is used only for ordering, not contiguity.
- `submit-move` no longer accepts unbounded input; the 200-move hard cap is enforced both client- and server-side. Clients sending more than 200 moves in a single API call (which today no UI does) would be rejected.
- The legacy single-move shape is still supported. We didn't break any deployed client; existing browser sessions still work mid-rollout.
- `coop-store.applyRemoteMove` is now a bit heavier (it computes a gap check on every event). At 100 moves the gap-check is ~5 μs — negligible.
- New utility script: `pnpm --filter @sudoku-squad/ingest verify:sync` (renamed from `verify:0014`) covers both 0014 and 0015 schema state.

---

## 0036 — Multiplayer sync rewrite: atomic seq, client_move_id, server-overlay coop store
**Date:** 2026-05-23
**Status:** Accepted (supersedes the optimistic-without-reconciler stance in [#TODO Phase 2 sync](TODO.md) and the LWW-by-application-order behavior of the original `coop-store.ts`)

**Context.** An end-to-end audit of the Phase 2 sync code found four concrete problems with the original optimistic-apply implementation:

1. **Coop divergence on same-cell race.** Dedup-by-`player_id` skipped a player's own realtime echo, but an earlier-seq remote move arriving at the same cell could clobber the player's higher-seq optimistic write. Result: A and B could permanently see different values for the same cell.
2. **Submit failures were never rolled back.** The architecture doc's "if server rejects, roll back" rule was unimplemented; the store comment acknowledged it. Net: any submit-move error left the local board permanently out of sync with the server.
3. **Global serial submit queue.** A single module-level Promise chain throttled all submits to one round-trip at a time. With `submit-move` warm at ~1.5 s, a fast typist's keystrokes piled up; opponents saw progress lag many seconds behind reality.
4. **`submit-move` seq assignment.** A read-max-then-insert-with-retry loop (up to 16 attempts) under concurrent submits, plus four sequential SQL round-trips before the insert. Both removable.

Plus two smaller things: a small race in coop init (subscribe and fetch were concurrent, so moves landing between the two could be lost), and lost-response duplicate-move risk on flaky mobile networks (no idempotency key).

**Decision.** Five changes, landed together so the client and server stay consistent:

1. **Atomic seq counter.** New column `rooms.next_seq bigint` (migration 0014). New RPC `reserve_room_seq(room_id) → bigint` does `update rooms set next_seq = next_seq + 1 returning next_seq - 1` — one round-trip, no retry loop, no contention on the moves unique index. `submit-move` reads `rooms` first (need mode + puzzle_code) then parallel-fetches player check, puzzle, and the idempotency-dup lookup.
2. **Client idempotency.** New column `moves.client_move_id text` with partial unique index on (room_id, client_move_id) when non-null. Every submit from the client now carries a uuid; a retried HTTP request with the same key dedupes server-side and returns the original seq + state.
3. **Submit queue removed.** `apps/web/lib/submit-queue.ts` is gone. Submits fire in parallel — the atomic seq counter made the serialization unnecessary.
4. **Coop store: server-overlay model.** Replace the old "apply optimistically + dedup-by-player_id" with a derived board:
   - `serverMoves: Map<seq, ServerMove>` — confirmed moves from the realtime channel.
   - `pendings: Array<{cid, move}>` — our own optimistic moves not yet echoed.
   - `remoteBoard = applyMoves(givens, serverMoves sorted by seq)` — recomputed on any change.
   - `board = applyMoves(remoteBoard, pendings)` — what the UI shows.

   Dedup is now by `client_move_id` (broadcast in the moves row), which is globally unique per move. When the realtime echo lands, the pending drops out of the overlay and the move moves into `serverMoves`. Same-cell races now converge correctly: both clients re-materialize the cell from the seq-sorted log, so LWW-by-seq holds regardless of arrival order.
5. **Coop init order.** Subscribe to moves BEFORE fetching the initial snapshot. Events landing during the fetch window go into the store's `pendingRemote` buffer and are drained (dedup'd by seq) when startCoop runs.

Companion changes:
- Submit failures now resync the board from the server: refetch all moves and rebuild remoteBoard, dropping the failed pending. Battle has a per-player equivalent (`fetchOwnMoves`). This realizes the "rollback" rule properly.
- Coop undo emits a server-side compensating move (`clear`, a re-place to the prior value, or a re-toggle for notes) so peers see the revert. Battle kept undo local-only here because the board is private — but that drifted the progress bar, so [#0039](DECISIONS.md) made battle undo/redo emit compensating moves too.

**Alternatives considered.**
- **CRDTs (Yjs / Automerge).** Strong correctness guarantee but harder to make server-authoritative, and overkill for an 81-cell grid. Server-authoritative LWW with seqs is simpler and matches our anti-cheat needs.
- **First-write-wins per cell.** Considered after the user expressed a preference for "first to add stays." Rejected for V1 — true first-write-wins requires server-side rejection of writes to non-empty cells, which conflicts with the natural "re-type to overwrite" UX and complicates the undo flow. LWW + visible cursors (existing plan) covers the collaborative case; the divergence bug being fixed here was the real complaint.
- **`board_snapshots` table for incremental materialization.** Skipped this PR. At V1 scale (moves per room < ~200), replaying the log on every submit-move is < 50 ms. Add when latency profiling justifies it.
- **Add a per-room broadcast channel** instead of `postgres_changes`. Considered. Realtime via `postgres_changes` is one extra DB write + one fanout latency hop, ~200 ms total. A `broadcast` channel would be lower-latency but requires the Edge Function to also call `channel.send`, which means a second auth hop. Defer until measured.

**Consequences.**
- `submit-move` is meaningfully faster (one round-trip for seq vs. the retry loop; parallel reads for the rest). Realistic warm latency target ~250 ms vs. ~1.5 s previously.
- The seq column can have small gaps when a client_move_id race causes a 23505 retry — the function falls through with the prior seq and the just-reserved one becomes a gap. Seqs are still monotonic and unique, which is all the ordering relies on.
- `next_seq` is reset to 1 by `start-game` on each new round. `return-to-lobby` doesn't touch it because the same `start-game` will reset it before the next round's first move.
- Coop's local undo redo stack is preserved across resyncs (it's per-player local state). On a hard resync, history stays intact — but cells in the undoStack may now refer to states that have been overwritten by other players' moves, in which case `redoHistory` falls back to dropping the orphaned entry (already handled in `packages/core/src/game/history.ts`).
- The `solution` exposure rules from [#0022](DECISIONS.md) are unchanged. Multiplayer still never receives `solution`.

---

## 0035 — Mode-first home flow + in-lobby difficulty toggle
**Date:** 2026-05-22
**Status:** Accepted

**Context.** The previous home page exposed every tier as a button under each game mode (Solo / Battle / Coop), which produced a wall of difficulty buttons before users had even decided what kind of game they wanted to play. With six total tiers (after #0033) the wall got longer. We wanted a cleaner first step: pick a mode, then pick a difficulty.

**Decision.** Reorganize the home page as a three-step state machine, and move the multiplayer difficulty choice into the lobby.

1. **Home page step 1 — Mode**: three vertically stacked buttons, no difficulties. Single-player / Co-op / Battle.
2. **Home page step 2 — Action**:
   - SP: expands to a vertical list of the five visible difficulty tiers (warmup / easy / medium / hard / expert).
   - Coop + Battle: expands to two horizontal buttons — **Create game** (calls `createRoom` with a default `medium` difficulty) and **Join game** (opens the open-lobby browser filtered to that mode).
3. **Home page step 3 — Join browser**: list of open public lobbies of the chosen mode; plus an inline "Or create your own" button; plus a "Have a code?" input. Joining a private link from the home page also still works via the code box.
4. **Lobby — Difficulty selector**: the host sees five buttons (warmup..expert) and can re-pick at any point while `status='lobby'`. Each click calls a new Edge Function `change-difficulty({ room_id, difficulty })` that re-picks a random puzzle of that tier via `pick_random_puzzle_code` and rewrites `rooms.puzzle_code`. Non-hosts see a read-only display of the host's choice ("Selected: Medium"), updated via the existing `rooms` realtime subscription.

Multiplayer difficulty lives at the room level (derived from the puzzle's tier via the new `fetchPuzzleDifficulty(code)` helper). No schema change — we don't denormalize difficulty onto `rooms`; the puzzle's `difficulty` column on `puzzles` is the source of truth.

The hidden `killer` tier (#0034) is **not** in the lobby's selector — it stays solely DB-side for a future "evil mode" reveal.

**Alternatives considered.**
- **Difficulty button per mode on the home page** (status quo from #0034). Rejected as cluttered.
- **`/join/[mode]` route for the public-lobby browser.** Would give shareable URLs, but the state-machine on the home page is simpler, faster, and the back button has nicer semantics (single click back to the mode picker).
- **Add a `rooms.difficulty` column.** Avoided — derivable from `puzzle_code`, and we'd have to keep it in sync on every `change-difficulty`. Single source of truth is cleaner.
- **Default the multiplayer create to whatever tier the user last solo-played.** Could be nice future polish; for V1 a fixed `medium` default is fine — the host can toggle in the lobby.

**Consequences.**
- New Edge Function `change-difficulty` (host-only, lobby-only, validates difficulty against the visible-tier set so callers can't promote rooms to `killer` via the API).
- `lib/rooms.ts` gains `changeDifficulty` + `fetchPuzzleDifficulty` helpers.
- `PublicLobbyList` accepts an optional `mode` filter and an `emptyState` slot so the join view can render "no open battle lobbies right now."
- Battle and coop CTAs no longer carry pre-chosen difficulty — they create rooms at the default and let the host toggle. This is also why Battle's start-condition gate is now mode-aware (battle requires ≥2 players, coop allows 1).
- The battle Playwright smoke was updated to traverse the new flow (`Battle → Create game`, `Battle → Join game → code`).

---

## 0034 — Shift tier labels up one, hide former-expert as `killer`
**Date:** 2026-05-22
**Status:** Accepted (renames the tier labels established in #0033 + #0032)

**Context.** After #0033 added warmup + beginner below the radcliffe-sourced tiers, the visible tier set was warmup / beginner / easy / medium / hard / expert. Play-testing the new beginner tier confirmed it solved like what "easy" should feel like, and the old "easy" (rating 0.0 from radcliffe) felt more like a relaxed-medium. So the labels were one notch too low across the board. Shift everything up one, drop the explicit beginner label, and hide the former-expert tier behind a new internal-only `killer` name.

**Decision.** Rename the puzzles.difficulty values:

| Old label | New label | Where it shows |
|---|---|---|
| warmup | warmup | visible (UI label "Warm-up") |
| beginner | easy | visible |
| easy | medium | visible |
| medium | hard | visible |
| hard | expert | visible |
| expert | **killer** | **hidden** (no UI button; reserved for a future "evil mode" exposure) |

The `Difficulty` type in `packages/core/src/types/index.ts` keeps all six values; a new `DIFFICULTIES_VISIBLE` constant lists the five exposed in the picker. The home page reads from that constant.

Migration 0013 does the rename in reverse order (`expert → killer` first so the rest can cascade without colliding), then re-installs the `CHECK (difficulty IN ('warmup','easy','medium','hard','expert','killer'))` constraint.

**Alternatives considered.**
- **Keep beginner and just relabel the radcliffe tiers.** Would have left a visible "Beginner" between "Warm-up" and "Easy" — but the QQWing beginner content IS easy by every reasonable definition, so labeling it that way is clearer.
- **Expose `killer` in the UI under the same name.** Rejected — the word reads as a meaningful brand choice we haven't earned yet; punt on the name until we have player feedback on the harder tiers.
- **Don't shift; rebalance content inside the existing labels.** Would require re-running both ingest pipelines with new band cuts. The shift-rename is metadata-only and reversible.

**Consequences.**
- Existing in-progress games / completion records reference puzzle codes, not difficulty labels. Unaffected.
- Battle and coop CTAs still expose `easy / medium / hard` buttons; those now point to easier content (what used to be beginner/easy/medium). The battle smoke continues to pass.
- The hidden `killer` tier is still solver-verified and pickable via direct URL `/play/{code}`. If a user finds a killer puzzle's code, they can play it. We just don't surface it from the picker.
- `scripts/ingest/src/index.ts` `RATING_BANDS` now points to `medium / hard / expert / killer` (radcliffe). `ingest-qqwing.ts` now writes to `warmup / easy` (QQWing). Future re-ingest will use these names.

---

## 0033 — Two easier-than-easy tiers via QQWing generation, rated in [-10, 0)
**Date:** 2026-05-22
**Status:** Accepted

**Context.** Even after #0032 narrowed easy to `[0, 0.75)`, players reported the entry-point puzzles still felt too hard. The 3M Kaggle dataset's natural floor is rating-0.0 with clue counts in the 24–28 range — there isn't a population of "almost-done" puzzles in there. To support truly trivial puzzles (kids/learners, warm-up mode), we need a separate source. We chose to *extend* the rating scale below 0 rather than re-tier the existing easy.

**Decision.** Two new tiers below easy, both populated via local **QQWing generation** (npm `qqwing@1.3.4`, wrapping Stephen Ostermiller's solver/generator):

- `warmup`   rating `[-10, -5)`, clue counts 35–40
- `beginner` rating `[-5, 0)`,   clue counts 29–34

Pipeline (`scripts/ingest/src/ingest-qqwing.ts`):
1. Generate via `QQWing.generatePuzzle()`.
2. `setRecordHistory(true)` then `solve()` to populate technique counters.
3. Keep only `getDifficulty() === SIMPLE` (naked-singles-only). ~3% acceptance rate from raw generation; effective throughput ~1.3 kept/sec single-threaded.
4. Pick a target clue count from a per-(tier, clues) weighted distribution (only cells with remaining target are considered).
5. **Augment** by adding random correct cells from the solution until the target clue count is reached. Adding correct givens can only constrain further, so the puzzle stays SIMPLE; we re-verify with the solver to be paranoid.
6. Solver-verify uniqueness (mirroring radcliffe ingest) and dedupe by puzzle code.

Rating formula: `rating = -((clues - 28) / 12) * 10`, clamped to `[-10, 0]`. 28 clues → 0 (boundary, doesn't enter the negative band), 34 clues → -5 (warmup/beginner boundary), 40 clues → -10.

Per-(tier, clues) targets (sum 2,500 each, 5,000 total):

| clues | warmup | beginner |
|---|---|---|
| 29 | — | 700 |
| 30 | — | 700 |
| 31 | — | 400 |
| 32 | — | 300 |
| 33 | — | 250 |
| 34 | — | 150 |
| 35 | 100 | — |
| 36 | 200 | — |
| 37 | 300 | — |
| 38 | 500 | — |
| 39 | 700 | — |
| 40 | 700 | — |

**Alternatives considered.**
- **Bryan Park's 1M Kaggle dataset** (avg ~33 clues): easier to wire up, but no technique metadata, uniqueness not guaranteed, and clue counts don't necessarily mean "naked-singles-only." Rejected — quality signal too weak.
- **grantm/sudoku-exchange-puzzle-bank** (pre-graded, QQWing-generated, uniqueness guaranteed): viable runner-up but requires downloading a large repo and parsing a custom format, and we'd still need to re-run technique checks to filter to naked-singles-only. Rejected because in-process QQWing generation is simpler.
- **Don't add a negative band; just re-bucket again.** Doesn't solve the actual problem — the 3M source genuinely doesn't have puzzles below rating 0.
- **`dokusan` Python generator** with technique-aware difficulty: better controllability but slower (~700ms each) and adds a Python dependency to the JS-only ingest pipeline. Rejected.

**Consequences.**
- Migration 0012 extends `puzzles.difficulty` check constraint to include `warmup` and `beginner`.
- `Difficulty` type in `packages/core/src/types/index.ts` adds the two new labels. Added `DIFFICULTIES_ORDERED` constant for UI lists.
- Home page picker (`apps/web/app/home-client.tsx`) now shows six tier buttons (Warm-up / Beginner / Easy / Medium / Hard / Expert).
- **Battle mode stays at easy/medium/hard** — warmup and beginner are intentionally SP-only since a 30+ clue puzzle would be over in seconds and not competitive.
- New ingest tool: `pnpm --filter @sudoku-squad/ingest ingest:qqwing`. Bypasses the radcliffe CSV. ~60 minutes for 5,000 puzzles single-threaded.
- The existing radcliffe-rated bank is untouched — these are additive rows.

---

## 0032 — Narrowing easy: rebucket to [0, 0.75) / [0.75, 2.5) / [2.5, 5) / [5, 7)
**Date:** 2026-05-22
**Status:** Accepted (supersedes the band choice in #0031; per-(tier, clue-count) targets unchanged)

**Context.** After #0031 shipped the four-tier bank with easy at `[0, 1.5)`, easy still played too hard for the casual entry point. Easy contained two visually-distinct populations: the bulk of rating-0.0 rows plus a long tail of rating-1.0-to-1.4 puzzles that solve like medium. The 3M dataset has a natural gap (no rows in `[0.5, 1.0)`), so a band ending at 0.75 effectively means "only rating-0.0 puzzles" — the gentlest the source supports.

**Decision.** New bands (half-open):
- `easy`   `[0.0, 0.75)` — uniformly rating-0.0 in practice.
- `medium` `[0.75, 2.5)` — the old "easy hard end" + the lower half of old medium.
- `hard`   `[2.5, 5.0)` — the upper half of old medium + the old hard.
- `expert` `[5.0, 7.0)` — unchanged.

Per-(tier, clue-count) targets (`TARGET_PER_CELL`) are unchanged. The 3M dataset's clue-count distribution is shape-invariant across rating bands, so the same targets remain feasible: every cell hit its mark on re-ingest with zero solver rejects across the 3M scan.

Resulting bank: 10,000 rows, exactly 2,500 per tier. Rating medians: easy 0.0, medium 1.7, hard 3.1, expert 5.3 (vs. #0031's 0.0 / 2.2 / 4.3 / 5.3 — medium and hard both got harder by design; the slack moved up from easy).

**Alternatives considered.**
- **Easy at `[0, 1.0)`.** Cosmetically the same as `[0, 0.75)` because there are no rows in `[0.5, 1.0)`. Picking 0.75 makes the intent explicit (we want strictly the trivial population) and survives a hypothetical future dataset that does have rows in that gap.
- **Easy at `[0, 0.5)`.** Same content as `[0, 0.75)` for this dataset, but worth choosing 0.75 in case a future re-ingest source has rows in `[0.5, 0.75)` that should count as easy.
- **Don't shift medium up; just steal from easy.** Would leave easy at `[0, 0.75)` and medium at `[0.75, 4)`. Tested mentally; medium ends up too wide (covers both visibly-easy 1.0s and visibly-hard 3.0s in the same bucket). Better to shift both boundaries together.

**Consequences.**
- Truncated `puzzles`, `player_completions`, `rooms` (cascading to `room_players` and `moves`) and re-ingested. Same migration story as #0031 — fine for V1 with no real users.
- Any URL someone bookmarked from a previous bank now 404s. The bundled sample pack (`apps/web/lib/sample-puzzles.ts`) is unaffected — those codes are pinned by hand to specific puzzles and the codes are deterministic from givens, so they still resolve via the bundled fallback even if the same puzzles aren't in the new DB sample.
- The Vercel UI's per-tier picker now shows much milder easy puzzles. Player feedback will tell us whether medium and hard remain accessible at the new boundaries.

---

## 0031 — Re-bucketing the puzzle bank: 4 tiers, per-(tier, clues) targets
**Date:** 2026-05-22
**Status:** Superseded by #0032 (bands shifted; per-(tier, clue-count) targets retained)

**Context.** The original V1 bank was 7,500 puzzles (2,500 easy/medium/hard, 0 expert) sampled by streaming the Kaggle 3M CSV in order and admitting the first 2,500 hits per rating band. An audit found this skewed easy heavily toward rating 0 (53% of easy were exactly rating 0.0) and left expert empty because the old band `rating > 7.0` matches only ~100 of 3M rows. We also wanted a clue-count gradient: easy should have more clues, expert fewer, matching how players think about difficulty.

**Decision.** New bands (half-open `[lo, hi)`), all 2,500 puzzles:

- `easy`   `[0.0, 1.5)`
- `medium` `[1.5, 4.0)`
- `hard`   `[4.0, 5.0)`
- `expert` `[5.0, 7.0)`

Rows with `rating ≥ 7.0` are skipped entirely — they're outside every band, and the old "fall back to clue count" path was silently admitting them to expert. The new `difficultyForRow` returns `null` when the rating doesn't fall in a band, and the loop skips on null.

Within each tier, a per-clue-count target distribution (`TARGET_PER_CELL` in `scripts/ingest/src/index.ts`) biases the bank: easy mode at 27 clues, expert mode at 22–23 clues, both with intentional spread across the dataset's 20–28 clue support. Each (tier, clue) cell's target was confirmed feasible against the 3M source via a preflight scan (`pnpm preflight:3m`).

Resulting bank: 10,000 puzzles, exactly 2,500 per tier. Clue medians shift cleanly: easy 27, medium 25, hard 23, expert 23. Rating medians shift cleanly: easy 0.0, medium 2.2, hard 4.3, expert 5.3.

**Alternatives considered.**
- **Stronger lean (e.g., expert mode at 21 clues).** Constrained by source: only 87 of 3M rows are 21-clue + rating 5.0+. We take all 87, but going further would require either more total expert rows (which leaves less variance) or padding from outside the rating band (defeats the purpose).
- **Preserve the raw rating on each `puzzles` row.** Considered for future analytics — would require a migration adding `rating numeric`. Deferred; the bucket label is sufficient for V1 gameplay.
- **Skip the re-ingest, re-bucket in-place.** Doesn't help: the rating data isn't stored on the row, only the tier label, and the existing rows were heavily biased toward rating 0 inside easy.

**Consequences.**
- Truncated `puzzles`, `player_completions`, and `rooms` (which cascades through `room_players` and `moves`). No real users yet, so no migration story needed beyond "any in-flight battle room is gone." Acceptable for V1.
- The `puzzles` row count is now **10,000** (was 7,500). The home page `listPuzzles()` still pages the full set with 1k-page PostgREST batches.
- Supersedes the old [DECISIONS #0018](DECISIONS.md) reasoning that expert was deferred pending a richer puzzle source — we now have a usable expert tier (5.0–7.0 rating) from the existing 3M dataset. A true "evil" tier (rating 7+) remains future work.
- New utility scripts: `pnpm --filter @sudoku-squad/ingest preflight:3m` (scan source distribution) and `pnpm --filter @sudoku-squad/ingest audit:difficulty` (audit the live DB). Both are idempotent + read-only (except the live `ingest --truncate` itself).

---

## 0030 — Return-to-lobby cycle: same room, `has_returned` per player
**Date:** 2026-05-22
**Status:** Accepted

**Context.** After a battle/coop ends, players want to play again with the same group. Two natural shapes: cycle the same room (status `lobby → playing → finished → lobby`) or create a fresh room each round. Players might also be at different rates — the winner is done immediately but a losing player may want to finish solving their own board first.

**Decision.** Same room cycles. Add `room_players.has_returned boolean default true`. When `room.status` transitions `playing → finished`, server flips every player's `has_returned = false`. A `return-to-lobby` Edge Function flips the caller's `has_returned = true` and transitions `room.status → lobby` if it isn't already. Players who haven't returned render greyed-out with a 3-dot waiting animation; the host can kick non-returned players to start sooner.

The host's "Start new game" succeeds only when every player has `has_returned = true`. The same `start-game` Edge Function does the reset: clears moves, picks a new random puzzle for the room, resets every `progress_pct` to 0, clears `winner_player_id` + `finished_at`, sets a new `started_at`.

**Alternatives considered.**
- **New room each round.** Cleaner per-game state; cheaper to reason about. Rejected because URL changes mid-flow feel less like "same room" and we'd need to broadcast the new room code to all current players.
- **Force everyone to finish before lobby reopens.** Stricter; punishes the winner with a wait.
- **Just navigate back to home and have everyone manually rejoin the same code.** Works, but it's friction.

**Consequences.**
- Two new state transitions on `rooms`: `finished → lobby` (idempotent) and `lobby → playing` (already exists but now usable on a previously-played room — the function clears prior state). Both must be atomic with respect to other writers.
- `moves` is wiped on each new game. That's fine — the move log is per-game; we don't yet have a "match history" feature that needs to keep it.
- This subsumes the "losers can keep solving" item ([previously task #27](TODO.md)): the loser sees the same finished-game UI until they explicitly click "Return to lobby". They can keep typing into their board until then. The server already refuses `submit-move` on `status='finished'`, so late typing is local-only; a later polish pass can make `submit-move` permissive for losers on finished rooms.

---

## 0029 — Public lobbies + host kick
**Date:** 2026-05-22
**Status:** Accepted

**Context.** Friend-and-family invites work via shared link, but discovery is also useful — open a room so anyone can join. Hosts need a kick to handle griefers or no-shows.

**Decision.** Two related additions:

- **`rooms.is_public boolean default false`.** Host toggles in the lobby. Public rooms appear in a new "Public lobbies" list on the home page (rooms whose `is_public = true` AND `status IN ('lobby', 'playing')`). The list refreshes via a Realtime subscription on `rooms`.
- **`kick-player({room_id, player_id})` Edge Function.** Host-only. Deletes the target row from `room_players`. The target's existing `room_players` subscription sees the delete and the client redirects them home with a message.

**Alternatives considered.**
- **Always-private; friend invites only.** Simpler but loses the discovery vibe that makes the multiplayer feel like a community.
- **Ban list per room.** Would let a kicked player not rejoin. Defer — repeat kick is acceptable for V1.

**Consequences.**
- No RLS change is needed for public listing — `rooms_read_all` already lets anon read every room. The home page just filters by `is_public = true`.
- Kick is destructive. The Edge Function is the authority — RLS doesn't need to grant the delete to clients.
- Public lobbies need light moderation later (username profanity filter — see Open Questions). Not blocking V1 since the kick is host-controlled.

---

## 0028 — Per-player puzzle completions stored server-side
**Date:** 2026-05-22
**Status:** Accepted (supersedes the localStorage-only solved tracker in `lib/solved-tracker.ts`)

**Context.** Today, "don't re-serve solved puzzles" lives in `localStorage` (`sudokusquad:solved`). It works for SP but doesn't survive a cleared cache, doesn't sync across devices, and doesn't count completions earned in multiplayer toward the same player. We also want a public-facing "you've solved N puzzles" count on the home page.

**Decision.** New table `player_completions(player_id uuid, puzzle_code text, mode text, completed_at timestamptz, primary key (player_id, puzzle_code))`. Server is the source of truth:

- `submit-move` inserts on the player's first win (multiplayer). `on conflict do nothing` so re-solves don't duplicate.
- New RPC `record_completion(p_code text, p_mode text)` for single-player. Called by `CompletionOverlay` once `isCompleteWithSolution` returns true. Same `on conflict do nothing`.
- Loser late-finishes (per [#0030](#0030)) also fire `record_completion`.
- New RPC `get_completion_count()` for the home page count. SECURITY DEFINER — reads only the caller's own rows via `auth.uid()`.
- "Don't re-serve solved" filter now reads from this table.

The local `solved-tracker.ts` can stay as a short-lived optimistic cache (avoids round-trip on the home page), but the DB is authoritative.

**Alternatives considered.**
- **localStorage only.** What we have today. Discarded for the reasons above.
- **A counter column on `auth.users`.** Cheaper read; can't distinguish which puzzles are solved (we'd lose dedupe).
- **One row per player+mode.** Doesn't dedupe across modes.

**Consequences.**
- Anonymous user identity is stable enough that this works in practice; if a player clears storage they get a new `auth.uid()` and the count restarts (acknowledged limitation of anon auth per [#0006](#0006)).
- Realtime subscription on `player_completions` could power a live count badge, but the home-page count is fetched once on mount.

---

## 0027 — Persistent client-generated username from a bundled wordlist
**Date:** 2026-05-22
**Status:** Accepted (supersedes the inline `adj-noun-NN` generator in `lib/username.ts`)

**Context.** The initial implementation generated names client-side from a small inline 15-adjective × 15-noun list with a numeric suffix. We want a much larger wordlist for variety and to drop the numeric suffix when there's enough alphabetic uniqueness.

**Decision.** A two-column CSV at `apps/web/lib/data/usernames.csv` (one row per pair slot; columns may be different lengths — short ones padded blank). A build-time script `scripts/build-word-lists.ts` converts the CSV into `apps/web/lib/data/word-lists.generated.ts` (committed). `lib/username.ts` imports the two arrays from that module; first-time visitors get a random `adj-noun` (no suffix unless wordlist size is small enough that collisions matter at our scale). localStorage continues to cache the chosen name.

**Alternatives considered.**
- **Server-generated names.** Round-trip on first visit; would require an Edge Function. Overkill.
- **Bundle the CSV as a raw asset.** Wordlists are small enough that a generated TS module is fine and avoids a runtime CSV parser in the bundle.
- **Numeric suffix always.** Loses the "real name" vibe. We'll add it back only if collisions become observable.

**Consequences.**
- The committed `.generated.ts` is the source the bundle reads; the raw CSV is for editability. Gitignore the CSV only if it's large (the build script regenerates from it).
- Future: optional "rename" Edge Function with profanity filter for public-launch hygiene ([open question #1](DECISIONS.md)).

---

## 0026 — Multiplayer max-players = 8 + 8-color palette
**Date:** 2026-05-22
**Status:** Accepted

**Context.** Original schema had no explicit max-player cap; the `join-room` Edge Function caps at 4. We're bumping the cap and the color palette together because the per-player color is allocated from the palette.

**Decision.** Cap = 8 in `join-room`. Color palette = 8 hex values chosen for visual distinctness at the 9 × 9 grid scale and reasonable accessibility contrast on white:

```
amber-500   #f59e0b   (warm yellow-orange)
sky-500     #0ea5e9   (light blue)
emerald-500 #10b981   (green)
rose-500    #f43f5e   (red-pink)
violet-500  #8b5cf6   (purple)
orange-600  #ea580c   (deep orange, distinct from amber)
teal-500    #14b8a6   (blue-green, distinct from sky/emerald)
fuchsia-500 #d946ef   (magenta)
```

**Alternatives considered.**
- **Stay at 4.** Simple, but limits coop discovery and public-lobby filling. 8 still feels manageable for cursor crowding in coop.
- **Cap at 6.** Common in similar apps (Down for a Cross, etc.). Reasonable but doesn't add much over 8 if the palette can sustain 8.
- **Dynamic palette / user-picked colors.** Adds friction; deferred to a hypothetical "customize your appearance" flow much later.

**Consequences.**
- `join-room` rejects the 9th joiner with `room_full`.
- The palette lives in `supabase/functions/_shared/room-code.ts` (`nextColor` picks the first unused). Same list referenced by the lobby UI for legend purposes.
- Battle-mode opponent progress bars work fine with up to 8 stacked rows.

---

## 0025 — Disconnect grace period: 2 minutes
**Date:** 2026-05-22
**Status:** Accepted

**Context.** The original ARCHITECTURE.md plan was 60 s. That's tight on mobile networks where a tunnel pop, screen lock, or 5G→LTE handoff can take ~30 s on its own.

**Decision.** A player has **120 s (2 minutes)** from disconnect to rejoin and pick up where they left off without their seat being freed. After that:
- In **battle**, their seat is freed; the game continues for everyone else.
- In **coop**, their seat is freed; their cursor disappears; the room continues.

Their move log is preserved either way — rejoining within the same room code restores their state.

**Alternatives considered.**
- **60 s.** Reasonable on desktop home wifi, frustrating on mobile.
- **5 minutes.** Generous, but holds an empty seat for far too long if someone genuinely abandoned.
- **No grace period (instant drop).** Simplest, but a single tunnel pop drops a player out of a tight battle.

**Consequences.** The lobby UI shows a "reconnecting…" badge during the grace window. The cleanup runs as a server-side timer (or on the next move from any other player — easiest is the latter). When the timer fires, server broadcasts a `player_left` event on the room channel.

---

## 0024 — Mid-game join policy: battle locks at Start, coop is open
**Date:** 2026-05-22
**Status:** Accepted

**Context.** Need to decide what happens when someone clicks a battle/coop room link after the game has already started. Letting joins continue mid-race is unfair (a fresh player has an unbeatable head start in battle). Letting them join mid-coop is fine and often desirable.

**Decision.**
- **Battle.** Once `rooms.status` transitions to `'playing'`, `join_room` refuses new joiners with a `room_in_progress` error. The client renders a "this battle has already started — start a new one" screen with a "New game" CTA.
- **Coop.** Joining is allowed at any time during `'lobby'` or `'playing'`. The new player picks up the current board state on join.
- **Finished rooms.** Both modes refuse joins with `room_finished`. The client offers "Play again" (creates a fresh room with the same players invited).

**Alternatives considered.**
- **Lock both at Start.** Symmetric and simple, but loses the "drop in to help" coop feel.
- **Open both, with battle starting newcomers from scratch.** Newcomer can't catch up; effectively eliminated before they start typing. Worse UX than refusing.
- **Battle: allow late join, count toward "didn't win" but no penalty.** Adds a third loser type and complicates the winner overlay.

**Consequences.**
- `join_room` Edge Function checks `(room.status, room.mode)` and returns one of three states: `ok` / `room_in_progress` / `room_finished`.
- The lobby route renders three branches off this state. Lobby copy is mode-aware.
- "Play again" creates a *new* room — preserves the move log of the old one for any future stats feature.

---

## 0023 — Edge Functions (not SQL RPCs) for multiplayer endpoints
**Date:** 2026-05-22
**Status:** Accepted

**Context.** Multiplayer needs `create_room`, `join_room`, `submit_move`, `check_completion`, `hint`. Each is a small bit of server-authoritative logic that validates inputs, mutates state across multiple tables, and (for `submit_move`) broadcasts on a Realtime channel. SQL RPCs (PL/pgSQL functions exposed via PostgREST) are the lighter alternative.

**Decision.** All multiplayer endpoints are **TypeScript Edge Functions** in `supabase/functions/`. Each function uses the service-role key to bypass RLS and is the sole authority for its mutation. PostgREST and RPCs (`sp_get_puzzle`) keep their narrow role: simple reads / single-player solution delivery.

**Alternatives considered.**
- **SQL RPCs (PL/pgSQL).** Smaller stack, faster cold start (no Deno). But: the move-validation logic (compute correctness without leaking solution to the client; check completion; broadcast on a Realtime channel) is harder to express in PL/pgSQL than TS. Test setup is also worse — no obvious unit-test path.
- **Mixed: simple ones as RPCs, complex ones as Edge Functions.** Two patterns to remember. Cost of consistency > cost of one extra Deno cold start.
- **Roll our own Node server.** Most flexibility, defeats the point of choosing Supabase.

**Consequences.**
- One toolchain (Deno + `supabase functions serve` for local dev, `supabase functions deploy` for ship). One auth pattern (functions take the user's anon JWT, derive `auth.uid()` from it server-side; service-role client for the actual mutation).
- Cold starts on Supabase Edge Functions are ~150–250 ms; acceptable for the cadence of game events (`submit_move` is hot enough to stay warm; `create_room` only runs once per game).
- All five functions live under `supabase/functions/` and share a `_shared/` utilities module (Supabase client constructors, error shape, etc.).

---

## 0022 — Single-player gets the solution; multiplayer never does
**Date:** 2026-05-22
**Status:** Accepted

**Context.** Hint and "auto-check" need to know the correct cell value. In single-player there's no other player to cheat against, so doing this check client-side is fine. In multiplayer it's anti-cheat-critical that `puzzles.solution` never reach the client.

**Decision.** Two distinct paths, deliberately *not* unified:

| Mode | How the client gets answers |
|---|---|
| Single-player (`/play/[code]`) | Calls the SECURITY DEFINER RPC `sp_get_puzzle(p_code)` which returns the full row including `solution`. The client uses the solution for hint, auto-check, and completion check locally. |
| Battle / coop (Phase 2+) | Client fetches givens via `puzzles_public` (no `solution` column) and goes through Edge Functions for hint reveal, server-validated cell-correct checks, and completion. `solution` never leaves the server. |

Multiplayer code MUST NOT call `sp_get_puzzle`. The RPC's comment in migration 0003 calls this out; we'll re-check it in code review when Phase 2 lands.

**Alternatives considered.**
- **Unify the path** — make SP also go through Edge Functions and stop returning the solution. Cleaner but doubles the Phase 1 effort (Edge Functions weren't needed for anything else) and gains no real security (SP has no one to cheat against).
- **Never return the solution, even in SP** — kill the hint feature in SP entirely. Worse UX.
- **Mix: SP also uses Edge Functions, but they're permissive** — confusing dual-purpose endpoints.

**Consequences.**
- A player who solved a puzzle in SP and later joins a coop room with the *same* puzzle has a slight advantage (they remember the answers). We accept this; V1 doesn't try to prevent self-spoiling.
- `sp_get_puzzle` is V1-only baggage if Phase 2 builds the same Edge Function hint flow for multiplayer. Once the multiplayer hint path exists, we *could* migrate SP onto it — kept as a future refactor. Until then the dual path is the simplest thing that works.
- The RPC is gated only by `grant execute … to anon`. Anyone can call it for any puzzle code. Acceptable for SP. If we ever want SP to also gate by player session, that becomes an Edge Function.

---

## 0021 — Room codes: 6-char lowercase base36, randomly generated
**Date:** 2026-05-22
**Status:** Accepted

**Context.** Multiplayer rooms need shareable codes for URLs like `/r/{code}`. Format choices: alphabet (Crockford base32, base36, base64-url), length, generation (random vs deterministic vs sequence).

**Decision.** Match the puzzle-code shape: **6 characters, lowercase base36 (0-9a-z), randomly generated**, unique in `rooms.code`. On collision, retry.

| Property | Value |
|---|---|
| Length | 6 |
| Alphabet | `0-9a-z` |
| Generation | Random (per `gen_random_bytes` or equivalent) |
| Collision retry | Yes — `rooms.code unique` enforces it, server retries on conflict |
| Lifetime | Tied to the room row; codes can be recycled after `rooms` is cleaned up |

**Alternatives considered.**
- **Crockford base32 (no I/L/O/U).** Friendlier when shared verbally. Rejected: rooms are shared via link, not voice; the cost of a second alphabet to remember isn't worth the marginal disambiguation.
- **Uppercase to visually distinguish from puzzle codes.** Cute but unnecessary — different URL paths (`/play/` vs `/r/`) prevent any real confusion.
- **UUIDs in the URL.** Too long; ugly.
- **Sequential / pretty short IDs.** Leak room creation cadence, no real benefit.

**Consequences.**
- Room and puzzle codes share a format. They live in different tables and different URL paths — no actual collision risk in URLs. A code string in isolation is ambiguous (you'd need to know if it's a `/play/` or `/r/` URL), but we never share codes in isolation.
- 36^6 ≈ 2.18B distinct codes. At any plausible concurrent-room count, collision probability is microscopic. The `unique` constraint catches the impossible case; the Edge Function retries with a fresh random.
- Phase 2 `create_room` Edge Function is the only place that generates these.

---

## 0020 — Puzzle code is the cross-mode puzzle reference (rooms.puzzle_code FK)
**Date:** 2026-05-22
**Status:** Accepted

**Context.** Migration 0001 declared `rooms.puzzle_id uuid references puzzles(id)`. Migration 0003 added `puzzles.code text unique` as the URL/short-share identifier. We now had two ways to reference a puzzle from a room (UUID and code) with no clear winner. Multiplayer is about to start using this column.

**Decision.** Rooms reference puzzles by `puzzle_code text references puzzles(code)`. Drop `rooms.puzzle_id`. The puzzle code is the single cross-mode identifier:

| Use | Identifier |
|---|---|
| Internal Postgres PK | `puzzles.id` (uuid) |
| URL slug for SP | `puzzles.code` → `/play/[code]` |
| URL slug for multiplayer rooms | `rooms.code` → `/r/[code]` (different namespace) |
| `rooms` reference to its puzzle | `rooms.puzzle_code` (FK to puzzles.code) |
| Move log scope | `rooms.id` (uuid, unchanged) |
| In-app `BoardState` identifier | `puzzleCode` (was `puzzleId`) |
| In-repo sample puzzles | pinned to the same hash |

Applied as migration `0004_rooms_puzzle_code_fk.sql`. `rooms` was empty in production so no data migration was needed.

**Alternatives considered.**
- **Keep both** (`puzzle_id` AND `puzzle_code` denormalized for read speed). Two identifiers for the same thing is exactly the conflation we wanted to remove. Skipped.
- **Keep only `puzzle_id`, never reference by code in the schema.** Forces every admin query / log line to JOIN to display the readable identifier. The code became the human-facing identifier the moment we built `/play/[code]`; the schema should reflect that.
- **Drop the UUID entirely** (use code as the PK on `puzzles`). Tempting but riskier — UUID PKs play nicely with Supabase tooling, RLS examples, and the future case where someone re-hashes a puzzle and we want to keep the row identity stable across the rename.

**Consequences.**
- `core.BoardState.puzzleId` was renamed to `puzzleCode`. `createBoard(puzzleCode, givens)`. The DB UUID isn't carried in the client at all — we never needed it client-side.
- The `puzzles.id` uuid stays as the internal PK. It's used by `moves`-as-yet-unbuilt (per Phase 2 design `moves.room_id` references `rooms.id`, no puzzle_id needed there).
- `puzzles_public` still exposes both `id` and `code` to clients. The `id` is now dead client-side surface — could be removed in a future migration if we want a tighter API, but it doesn't cost anything to leave.
- Schema is now: puzzle = `(id uuid, code text unique)`, room = `(id uuid, code text unique, puzzle_code text fk)`.

---

## 0019 — Puzzle codes: 6-char deterministic base36 hash of givens
**Date:** 2026-05-22
**Status:** Accepted

**Context.** The single-player flow needs a short, URL-friendly puzzle identifier — short enough to share comfortably, opaque enough that "puzzle 1" doesn't leak ordering, deterministic so the same puzzle always has the same id across re-ingests and so the in-repo sample puzzles can match Supabase rows.

**Decision.** `code = base36( first 40 bits of md5(concat(givens)) mod 36^6 )`, padded to 6 chars. Lowercase a-z + 0-9. Stored as `puzzles.code text not null unique`, indexed.

| Property | Value |
|---|---|
| Length | 6 |
| Alphabet | `0-9a-z` (base36) |
| Collision space | 36^6 ≈ 2.18B |
| P(collision) at 7 500 rows | ~1.3e-5 (negligible) |
| P(collision) at 1 M rows | ~0.0002 (0.02 %) |
| P(collision) at 10 M rows | ~0.023 (2.3 %) |

Computed identically in Postgres (PL/pgSQL `puzzle_code_for(smallint[])`) and TypeScript (`scripts/ingest/src/code.ts`). The TS test `code.test.ts` pins two hashes; if the algorithm ever changes both must move together AND we re-hash existing rows in a follow-up migration.

**Alternatives considered.**
- **nanoid(6) random alphabet.** Larger collision space (64^6 ≈ 68 B) so safer at scale, but not deterministic — re-ingest produces different codes, and the in-repo sample pack would need bespoke codes that drift from Supabase.
- **Sequential base36 of `bigserial`.** Shortest possible (~4 chars at 1 M, ~5 at 10 M), no collision risk. Rejected because it leaks total puzzle count and ordering, and is awkward to compute for in-repo samples.
- **8 chars instead of 6.** Comfortably collision-free at 10 M+ scale. Rejected as longer than necessary for our planned scale.
- **Crockford base32 (no I/L/O/U).** Smaller alphabet (32) gives slightly less collision headroom; the disambiguation only matters for verbally-shared codes. URLs make it moot.

**Consequences.**
- URLs look like `/play/cbotju`. Short, shareable, opaque.
- If we ever scale past ~1 M live puzzles, collision probability becomes noticeable (~0.02 %). The unique constraint catches it; the TS ingest needs to gain a retry-with-salt path. The migration's safety-net `do $$` block does this for the initial backfill.
- The same algorithm runs at ingest time (to compute the code before insert) and in `apps/web/lib/sample-puzzles.ts` (codes pinned to compile-time values). `verify-samples` checks the pinning.

---

## 0018 — V1 puzzle pool: 7 500 rows from the Kaggle 3M dataset, no expert tier yet
**Date:** 2026-05-22
**Status:** Accepted (supersedes parts of [#0011](#0011))

**Context.** The actual ingest had to choose: (a) which Kaggle variant to mine, (b) how many puzzles to take, (c) what difficulty mix. We dry-ran against the user-selected dataset, `radcliffe/3-million-sudoku-puzzles-with-ratings`, before committing to an insert.

**Decision.** Ingest 7 500 puzzles — 2 500 each in `easy` / `medium` / `hard`. Expert tier target is **0** for now. Difficulty is read from the dataset's numeric rating with these cut points:

| Tier | Rating |
|---|---|
| easy | ≤ 2.5 |
| medium | 2.5 – 5.0 |
| hard | 5.0 – 7.0 |
| expert | > 7.0 |

**Alternatives considered.**
- Use the 1M Kaggle dataset (`bryanpark/sudoku`). Smaller, no difficulty column — we'd have to derive difficulty from clue count. The 3M dataset has both rating and clue count, so it's a strict superset of useful signal.
- Target 10 000 puzzles (2 500 × 4 tiers). Rejected because the 3M dataset only has ~100 puzzles rated > 7.0 — not enough for a meaningful expert sample. Sampling forced rebucketing of "expert" to mean something looser than the standard sudoku-app definition, which we'd rather not do.
- Skip the rating column and bucket purely by clue count. Rejected because this dataset's clue counts cluster in 22–26, so clue-count buckets all collapse into hard/expert — wouldn't give us an easy tier at all.

**Consequences.**
- Live `puzzles` table has 7 500 rows. Web single-player still uses the bundled pack until the Supabase fetch lands.
- Expert tier is empty in V1. If/when we want one, we either (a) source from a different high-difficulty pack and re-run with `expert = 2500`, or (b) loosen the threshold (would re-bucket what "expert" means).
- The 535 MB source CSV is gitignored in `scripts/ingest/data/sudoku-3m.csv`. Re-running the ingest later picks up wherever it left off (it appends; truncate manually for a clean slate).
- The `puzzles_public` view had to be re-created in migration 0002 to make this useful — the original `security_invoker = true` setting made the view return zero rows to anon.

---

## 0017 — Bundled sample-puzzle pack as the single-player source until ingest lands
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Phase 1 single-player UI was ready to build before the Kaggle dataset was ingested. The `puzzles` table is empty. We needed *some* puzzles to play against so the UI work could be developed and verified end-to-end without blocking on the multi-GB dataset download.

**Decision.** Ship a small hand-picked pack in `apps/web/lib/sample-puzzles.ts` (currently 5 puzzles across easy/medium/hard). Each puzzle is verified by the Norvig solver via `scripts/ingest/src/verify-samples.ts` (`pnpm --filter @sudoku-squad/ingest verify:samples`) to have a unique solution and a matching answer. Solutions live client-side in the bundled file — this is intentional for single-player because there is no one to cheat against.

When the Kaggle ingest lands and `puzzles` is populated, single-player switches to fetching from `puzzles_public` (no solution column) and uses the same server-side completion check that multiplayer will use. The bundled pack can stay as an offline fallback for dev, or be deleted.

**Alternatives considered.**
- Block UI work until ingest finishes. Linear but slower — the dataset download + sampling is its own chunk of work and we'd lose the chance to verify the UI in parallel.
- Manually insert a few rows directly into Supabase via SQL. Equivalent net effect but ties dev to a network call and credentials.
- Generate puzzles on the fly. Out of scope — see [#0011](#0011) and [#0012](#0012).

**Consequences.** The web app ships with a small bundled puzzle pack as long as `lib/sample-puzzles.ts` exists. The hint feature in single-player works because the bundled solution is local; this code path will need to change to a server RPC the moment we switch to Supabase puzzles. Documented in [STATUS.md](STATUS.md) gotcha #7.

---

## 0016 — pnpm 11 build-script approval via `allowBuilds:` in `pnpm-workspace.yaml`
**Date:** 2026-05-21
**Status:** Accepted

**Context.** pnpm 10+ defaults to NOT running postinstall scripts for native-binary packages — a security-by-default change. Our toolchain needs three to actually function: `esbuild` (Vitest bundler), `sharp` (Next.js image optimization), `unrs-resolver` (ESLint module resolver).

**Decision.** Approve these three in `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  esbuild: true
  sharp: true
  unrs-resolver: true
```

These are the standard binary-fetch scripts for our stack and are widely used. We only allow scripts for packages we explicitly trust; new ones surface as install warnings (`ERR_PNPM_IGNORED_BUILDS`) and require an explicit add to the list.

**Alternatives considered.**
- `pnpm approve-builds` interactive command — does the same thing but interactive only; we want the config in version control.
- `--ignore-scripts` opt-out — would break Vitest and image optimization at runtime.

**Consequences.** New native-binary deps require an explicit allowlist update. Future agents adding such deps will see the install warning and should add the package here, not work around it.

---

## 0015 — Internal imports inside our own packages are extensionless
**Date:** 2026-05-21
**Status:** Accepted

**Context.** TypeScript ESM convention is `import './foo.js'` (the `.js` extension is what the emitted code will use at runtime under Node native ESM). However, Next.js's webpack-based bundler does not resolve `.js` imports back to `.ts` source files in workspace packages, even with `transpilePackages`. The result: `Module not found: Can't resolve './types/index.js'` errors during Next builds.

**Decision.** Inside `packages/core`, `scripts/ingest`, and any future workspace package: relative imports are **extensionless** (`import './foo'`, not `import './foo.js'`). `node_modules` imports are unaffected.

**Alternatives considered.**
- Add a Next.js webpack alias to strip `.js` from workspace imports — fragile, more config, hidden behavior.
- Build `packages/core` to `dist/` and consume the build instead of source — slower DX, defeats the point of `transpilePackages`.
- Switch the entire repo to CJS — large regression in tooling, no benefit.

**Consequences.** Vitest, `tsx`, and Next's bundler all resolve extensionless imports to `.ts` source files in workspace packages. The cost is that we couldn't run these files directly with Node native ESM without a TypeScript compile step — but we never do that (Vitest, tsx, and Next are our runtimes). Documented in [CLAUDE.md](../CLAUDE.md) §2 so it's not relearned.

---

## 0014 — pnpm as the package manager
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Needed to pick between npm, pnpm, and yarn for the monorepo.

**Decision.** pnpm 9.x, pinned via `packageManager` field in the root `package.json`.

**Alternatives considered.**
- **npm.** Ships with Node, workspaces work, but it allows phantom dependencies — code that imports an undeclared transitive dep works locally and breaks elsewhere. This is exactly the bug pattern we want to prevent from leaking into `packages/core`.
- **yarn.** Classic is unmaintained; berry has compatibility friction with some tools. No upside over pnpm.

**Consequences.** Strict dependency resolution acts as automated enforcement of the `packages/core` purity rule. Content-addressable store gives faster installs. One-time install required (`npm install -g pnpm`). Lockfile is `pnpm-lock.yaml`.

---

## 0013 — Verification strategy: property tests in core, two-tab Playwright smoke, solver-verified ingest
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Need to decide how we'll get to high confidence that the engine and multiplayer sync are correct. Unit tests alone won't catch the distributed-systems bugs.

**Decision.** Three layers of verification:
1. **Property-based tests** in `packages/core` using `fast-check` (or vitest's built-in). Generate random valid move sequences and assert invariants: no cell ever contains an invalid value; the board derived from a move log equals the board after applying each move in order; applying moves in any order consistent with `seq` produces the same final state.
2. **Two-tab Playwright smoke test** in CI. Opens two browser contexts in the same coop room, has both spam-input into the same cells, asserts state convergence. Runs on every PR.
3. **Solver-verified ingest.** Every puzzle entering the `puzzles` table is run through our Norvig-ported solver; any with zero or multiple solutions is rejected.

We also keep classic unit tests (~90% coverage target in core) and a small Playwright happy-path smoke (create room → both players join → play to completion).

**Alternatives considered.**
- Only unit tests. Insufficient for distributed-systems bugs (race conditions, reconnect).
- Manual two-browser testing as the smoke. Doesn't scale and breaks the moment a regression slips in between manual runs.
- CRDT-based sync (Yjs/Automerge) to make conflicts impossible by design. Overkill for an 81-cell grid; significantly harder to make server-authoritative for anti-cheat.

**Consequences.** Up-front investment in test infrastructure (~1–2 days). High confidence on V1 correctness. The two-tab Playwright test becomes our load-bearing regression catcher and must be kept green.

---

## 0012 — Sudoku engine from scratch in `packages/core`; solver lives in ingest only
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Could pull in `sudoku-core` (npm) or write our own. The engine is small enough that the tradeoff is "save a day vs. take a dependency on code we'd read line-by-line anyway."

**Decision.** Write our own sudoku engine in `packages/core` (~400 LoC: types, validators, conflict detection, move reducer, completion check). No external sudoku library at runtime. **The Norvig-ported solver lives in `scripts/ingest` (or similar), not in `packages/core`** — it's used once at dataset ingest time to verify each puzzle has a unique solution, and never ships to clients.

**Alternatives considered.**
- Use `sudoku-core` npm package. Saves ~1 day but adds maintenance dependency and unfamiliar code paths.
- Put solver in `packages/core` for runtime hints. **Rejected**: runtime features (hints, win check, auto-check) all use `puzzles.solution` from the dataset directly. No need to ship a solver to clients.

**Consequences.** `packages/core` is small (~400 LoC) and tightly scoped. Smaller attack surface, smaller bundle. Solver code lives in ingest-time scripts and can be slow/heavy without affecting runtime. Future V2 features that genuinely need a solver (custom puzzle generation, "smart hints" with deduction steps, custom difficulty rating) can adopt the same Norvig implementation from scripts.

---

## 0011 — Kaggle 9M Sudoku dataset as the V1 puzzle source
**Date:** 2026-05-21
**Status:** Superseded by #0018 — we ended up using the 3M variant (`radcliffe/3-million-sudoku-puzzles-with-ratings`) because it ships a numeric difficulty rating column. Original entry retained for context below.

**Context.** Need a puzzle source for V1. Building a generator is out of scope. The dataset needs to come with difficulty ratings and ideally pre-validated unique solutions.

**Decision.** Use the Kaggle "9 million Sudoku puzzles" dataset (or similar 1M variant if it's friendlier to download). CSV format: `puzzle,solution[,difficulty]` per row. Ingest 500–1000 medium-difficulty puzzles into the `puzzles` table for V1.

**Alternatives considered.**
- Build our own generator. Real time sink, out of V1 scope.
- Smaller curated GitHub puzzle packs. Often lack difficulty rating or are smaller than we want.
- HoDoKu-generated puzzles. Better difficulty rating but requires running HoDoKu (Java).

**Consequences.** One-time ingest script in `scripts/ingest/` reads the CSV, runs the Norvig solver to verify uniqueness (per [#0012](#0012)), and upserts into Supabase. Both `givens` and `solution` come from the dataset directly. Difficulty rating is whatever the dataset provides. If V2 wants more varied or self-generated puzzles, we replace the ingest source without changing the runtime engine.

---

## 0010 — Name: Sudoku Squad
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Used "Sudoku Squad" as a working title while writing the initial docs. Needed to confirm before registering a domain, branding the app, or submitting to the App Store.

**Decision.** "Sudoku Squad" is the real name.

**Alternatives considered.** None were actively proposed; the placeholder fit.

**Consequences.** Domain to register (sudokusquad.com is the natural first try). App Store listing, repo name, and copy throughout the app all use "Sudoku Squad." Visual identity and logo still TBD.

---

## 0009 — All game settings are per-room (host configures in lobby)
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Auto-check, hints, show-conflicts, and other gameplay settings could each be per-player private prefs or per-room settings set by the host. Per-player creates asymmetric advantages in battle and uneven coop experiences. Per-room is uniform but more paternalistic.

**Decision.** All game settings are per-room. The host picks them at the lobby; once the game starts, the settings panel is read-only. Single-player has its own settings (no other players to coordinate with).

**Alternatives considered.**
- Per-room for fairness-sensitive settings (auto-check, hints), per-player for purely cosmetic (highlight same number). Two UIs, fuzzy boundary.
- All per-player. Simpler to build but allows asymmetric play in battle and inconsistent coop experience.

**Consequences.** Lobby UI gains a settings panel that the host edits. After Start, the panel becomes read-only for everyone. A player who'd prefer different cosmetic settings has to ask the host. Single-player keeps a private in-game settings sheet.

---

## 0008 — Battle: losers can keep solving after a winner is declared
**Date:** 2026-05-21
**Status:** Accepted

**Context.** When one battle player finishes and wins, the others are partway through. Ending their game abruptly removes the satisfaction of finishing what they started.

**Decision.** When a winner is declared, every player sees an overlay announcing the winner. Losers can dismiss the overlay and continue solving their own board. The result is already final and recorded.

**Alternatives considered.**
- Game ends for everyone immediately. Cleaner UX, faster turn-around to play-again, but abrupt.
- Modal asking each loser: "finish anyway?" Most explicit, slightly more to build.

**Consequences.** Battle has two end states: "decided" (winner announced, others may still be solving) and "fully closed" (everyone has finished or quit). Play-again button shows immediately for the winner; for losers it appears after they finish or dismiss the continue option.

---

## 0007 — Coop notes: shared by default, with a private-notes mode (V1 stretch)
**Date:** 2026-05-21
**Status:** Accepted

**Context.** In coop, pencil marks could be shared across players (matches the collaborative spirit; matches solving on paper together) or private per player (parallel reasoning without stepping on each other's marks).

**Decision.** Default is shared/merged notes: toggling a note adds or removes the mark for everyone. We additionally support a per-player "private notes" mode — when on, that player's pencil marks are invisible to teammates and don't affect the shared set.

**Alternatives considered.**
- Shared only. Simplest. Doesn't accommodate "I'm reasoning through a chain; don't show my partner my noise."
- Private only. Loses the visible collaboration that makes coop feel coop.

**Consequences.** Notes data model has two streams per cell: a shared set (room-wide) and a private set (per player, client-only). UI gets a "Private notes" toggle near the number pad. Server broadcasts shared-notes changes; private notes never leave the client. **V1 stretch:** if this becomes a time sink, descope to shared-only and move the private toggle to V2. Flagged in `docs/TODO.md`.

---

## 0006 — Anonymous auth + per-room usernames
**Date:** 2026-05-21
**Status:** Accepted

**Context.** V1 needs to be frictionless — clicking a link should drop you straight into a game. Full account systems (email, OAuth) add steps and a privacy ask we don't need yet.

**Decision.** Supabase anonymous auth. Each device gets a stable anon user ID (cached in localStorage / AsyncStorage). Username is chosen per-room and stored on `room_players`.

**Alternatives considered.**
- Magic link / email accounts — more friction, more value once we have history/stats.
- OAuth (Apple/Google) — required for App Store eventually but not yet for web V1.
- Both anonymous + accounts — more to build; defer.

**Consequences.** No password reset flows, no profile pages, no friends list. We *do* need to handle the case where a user clears storage and loses their anon ID. Reconnection within a session is reliable; long-term identity is not. We commit to building proper accounts in V2.

---

## 0005 — Vercel + Supabase for hosting
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Need to host the web app and the backend cheaply and with minimal ops.

**Decision.** Vercel for `apps/web`, Supabase Cloud for Postgres/Realtime/Edge Functions.

**Alternatives considered.**
- Fly.io / Railway — more control, predictable pricing.
- AWS — overkill for V1.

**Consequences.** Generous free tiers should cover us through demo. Vendor lock-in is real but acceptable — both pieces are replaceable later (Postgres is portable, Next.js is portable). Edge Functions are the most lock-in-y piece; we keep them small.

---

## 0004 — Supabase for backend (Postgres + Realtime + Edge Functions)
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Multiplayer sudoku needs realtime sync + durable game state + some server-authoritative logic (for cheat prevention and completion checks).

**Decision.** Supabase. Postgres holds rooms/players/moves/puzzles. Realtime channels broadcast moves and presence. Edge Functions host server-authoritative validators.

**Alternatives considered.**
- Firebase — strong but expensive at scale and Google lock-in.
- Custom Node + WebSockets — most control, most ops work.
- Partykit / Cloudflare Durable Objects — purpose-built for rooms, but newer/less familiar. Strong "if Supabase doesn't pan out" candidate.

**Consequences.** First-class SDKs for both web and React Native. Postgres lets us reason about state durably. Realtime quota is the thing to watch — we throttle presence updates to ~10/s to avoid burning quota.

---

## 0003 — React Native + shared TypeScript core for cross-platform
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Cross-play between web and iOS is an explicit goal. Need to decide how the iOS app is built.

**Decision.** Web in Next.js. iOS (Phase 4) in React Native via Expo. A shared TS package `packages/core` contains all game logic, types, validators, and Supabase sync — both clients import it.

**Alternatives considered.**
- Native Swift — best iOS polish, but doubles client work and forces all game rules onto the server.
- Capacitor wrapper — fastest path but doesn't feel native; App Store review risk.
- Flutter — would require rewriting the web app in Dart; throws away the React/Supabase ecosystem.

**Consequences.** Lint rule needed on `packages/core` to ban DOM/Next/RN imports. UI is written twice (~600 LoC per platform) but logic is written once. Cross-play is effectively free because both clients run the same sync code. Need to budget an explicit iOS polish sprint for haptics, keyboard, and iOS-feel.

---

## 0002 — Lean V1 scope
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Could either ship a minimal demo fast or a polished v1 with many tiers/settings.

**Decision.** Lean V1: single difficulty tier, small puzzle pack, minimal settings, anonymous-only. Get to a playable multiplayer demo we can share with friends, then iterate.

**Alternatives considered.** Full-featured V1 (all tiers, accounts, leaderboards) — slower to first demo, harder to validate fun.

**Consequences.** [ROADMAP.md](ROADMAP.md) Phases 1–4 are scoped to "good enough to play and enjoy." Anything else is V2.

---

## 0001 — Web first, then iOS, no Android in V1
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Need to pick a target order.

**Decision.** Single-player web → battle web → coop web → iOS. Android is out of scope for V1 and we don't commit to it in V2 either.

**Alternatives considered.** iOS-first (closes the door on quick iteration); web + Android first (no compelling reason); all three at once (too much).

**Consequences.** Web is the proving ground for both UX and protocol. iOS comes only after the protocol is stable, which is why `packages/core` is set up early.

---

# Open questions (live)

Resolved items get moved into the log above. These are still TBD. Items grouped by when they have to be decided.

## Decide before Phase 2 ships

1. **Username profanity filter** — not needed for friend-and-family beta. Defer; revisit when a public-launch ask is real.

## Decide during Phase 2/3

2. **Battle tiebreak when no one finishes within N minutes** — needed? Threshold? Leaning "no hard time limit in V1; people quit naturally."
3. **Host migration in coop** — automatic transfer to the longest-tenured remaining player, or require acknowledgement?
4. **Mobile cursor visualization in coop** — phones have no persistent cursor. Working assumption: ring persists on last-tapped cell, fades after ~3 s of inactivity. Validate during coop UI work.
5. **`board_snapshots` table** — add now for fast rejoin or wait until measurable problem? Leaning wait.

## Open longer-term

6. **Visual identity** — color palette, typography, logo, completion celebration style. Current interim is Tailwind stone-900 + amber-200 accents (sufficient for V1 demo, not committed to). Needs a design pass before any public-facing push.
7. **Expert tier sourcing** — the 3M Kaggle dataset has only ~100 puzzles rated > 7.0, not enough for a 2 500-row sample (per #0018). Find or generate a higher-difficulty source before re-enabling the tier.
8. **Vercel ↔ Supabase preview environment** — preview deploys currently hit the *production* Supabase project. Fine for V1; revisit before more users.

## Recently resolved (and where it landed)

- **Edge Function vs SQL RPC for multiplayer endpoints** — resolved in #0023 (TS Edge Functions across the board).
- **Mid-game join behavior** — resolved in #0024 (battle locks at Start, coop is open anytime, finished refuses).
- **Disconnect grace period** — resolved in #0025 (2 minutes).
- **Puzzle code format** — resolved in #0019 (6-char lowercase base36, deterministic from givens).
- **Room code format** — resolved in #0021 (6-char lowercase base36, random, retried on collision).
- **Cross-mode puzzle reference** — resolved in #0020 (`rooms.puzzle_code` FK to `puzzles.code`).
- **`rooms.mode` includes `single`** — resolved (dropped via migration 0004; single-player doesn't use rooms).
- **Coop offline-merge rule** — resolved in #0040 (rule A: pure LWW, persistence scoped to reconnect/refresh resume; escalate to fork-aware C only if true offline coop is needed).
- **Solution exposure for SP vs. multiplayer** — resolved in #0022 (SP uses the `sp_get_puzzle` RPC; multiplayer uses Edge Functions that never expose `solution`).
- **Puzzle dataset variant** — resolved in #0018 (Kaggle 3M with the rating column; supersedes #0011).
