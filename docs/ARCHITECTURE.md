# Architecture

This document defines the technical foundation for Sudoku Squad: stack, data model, realtime sync model, conflict resolution, and the plan for sharing code between web and iOS.

---

## 1. High-level stack

| Layer | Choice | Rationale |
|---|---|---|
| Web client | **Next.js 15 (App Router) + React 19 + TypeScript + Tailwind** | Best DX, easy Vercel deploy, server components useful for puzzle fetching. |
| iOS client (Phase 4) | **React Native via Expo** | Shares TypeScript core with web; first-class Supabase SDK. |
| Shared logic | **`packages/core` (TS)** | Game logic, validators, sync helpers — consumed by both clients. |
| Realtime / DB | **Supabase (Postgres + Realtime + Edge Functions)** | Postgres for durability, Realtime channels for live sync, Edge Functions for any server-authoritative logic. |
| Auth | **Supabase anonymous sessions** | No signup. Each browser/device gets an anon user ID; username is per-room. |
| Hosting | **Vercel (web) + Supabase Cloud** | Generous free tiers, deploy in minutes. |
| State (client) | **Zustand** (or React Context for V1) + Supabase Realtime subscriptions | Simple, plays well with TS. |
| Package manager | **pnpm 11** (workspaces) | Strict dep resolution enforces the `packages/core` purity rule. Per [DECISIONS.md #0014](DECISIONS.md). |

---

## 2. System diagram

```
+----------------+         +----------------+         +-------------------+
|  Web (Next.js) |  <-->   |   Supabase     |  <-->   |  iOS (RN, future) |
|  React + TS    |         |  Postgres +    |         |  React Native     |
|                |         |  Realtime +    |         |                   |
|                |         |  Edge Funcs    |         |                   |
+-------+--------+         +--------+-------+         +---------+---------+
        |                           |                           |
        +-------- packages/core (shared TS: game logic, sync, types) --------+
```

Both clients import the same `packages/core`. Both subscribe to the same Supabase Realtime channel per room. Server is the durable source of truth; clients are optimistic and converge.

---

## 3. Repo layout

We use a **pnpm workspace monorepo** so the shared package is trivial to import.

```
sudoku-squad/
  apps/
    web/                  # Next.js — the live app
      app/                # routes: /, /play/[code], /r/[code]
      components/         # SP + battle boards, number pads, overlays,
                          # keyboard controllers, settings panels, icons
      lib/                # game-store + battle-store (zustand), puzzle-source,
                          # pick-puzzle, completions (server-backed), rooms,
                          # username, supabase, sample-puzzles, confetti
      e2e/                # Playwright smoke (single-player keyboard solve)
    ios/                  # Expo / React Native (added in Phase 4)
  packages/
    core/                 # SHARED — must stay platform-agnostic
      src/
        puzzle/           # board construction, conflict detection (NO solver)
        game/             # reducer (with auto-clean peer notes),
                          # notes bitmask helpers, history (multi-cell undo)
        types/            # shared TS types
                          # (sync/ deferred — battle-store does optimistic
                          #  apply directly; revisit when coop's LWW forces it)
  scripts/
    ingest/               # one-off: dataset import, Norvig solver, code hashing
      data/               # gitignored: source CSVs from Kaggle
      fixtures/           # small in-repo synthetic CSVs (committed)
      src/                # solver, csv reader, code hash, ingest entrypoint,
                          # preflight-3m (source scan), audit-difficulty
                          # (live DB audit), check-connectivity
  supabase/
    migrations/           # 0001..0011 applied to live project
    functions/            # Edge Functions: create-room, join-room, start-game,
                          # submit-move, claim-username, kick-player,
                          # update-room-settings, return-to-lobby
  docs/                   # STATUS, GOALS_AND_SCOPE, ARCHITECTURE, ROADMAP,
                          # TODO, DECISIONS, GAME_DESIGN
  .github/workflows/      # CI: lint + typecheck + tests + Playwright
  package.json
  pnpm-workspace.yaml
```

**Critical rules** enforced by `packages/core/eslint.config.js`:
- No imports from `next/*`, `react-dom/*`, `react-native/*`, `expo/*`.
- No imports from `scripts/ingest/**` or `@sudoku-squad/ingest` (the Norvig solver lives there — never ship to clients).
- No direct access to DOM globals (`window`, `document`, `localStorage`, etc.). Platform capabilities must be injected (see §8).
- `react` itself is allowed for hooks; no JSX components live in `packages/core`.

---

## 4. Data model (Supabase / Postgres)

Live SQL is in `supabase/migrations/`. Tables below reflect what's actually applied to the project (migrations 0001 → 0011).

### `puzzles`
Pre-generated puzzles. Immutable once ingested. **15,000 rows** live as of 2026-05-22 across **six tiers** (five visible, one hidden after the #0034 rename): 2,500 each in warmup / easy / medium / hard / expert / killer. Warmup + easy come from local QQWing generation (naked-singles-only, augmented to high clue counts); medium / hard / expert / killer come from the Kaggle 3M `radcliffe/3-million-sudoku-puzzles-with-ratings` dataset. See [DECISIONS #0032](DECISIONS.md) (radcliffe bands), [#0033](DECISIONS.md) (QQWing tiers), and [#0034](DECISIONS.md) (shift-rename).

| col | type | notes |
|---|---|---|
| `id` | uuid PK | Internal DB key. Not visible client-side. |
| `code` | text unique not null | 6-char lowercase base36 hash of `givens`. URL slug and the cross-mode puzzle identifier. Per [DECISIONS.md #0019](DECISIONS.md). |
| `difficulty` | text | `warmup` / `easy` / `medium` / `hard` / `expert` / `killer`. All six tiers populated. Rating bands by source: warmup rating `[-10, -5)`, easy `[-5, 0)` (both via QQWing — see [#0033](DECISIONS.md)); medium `[0, 0.75)`, hard `[0.75, 2.5)`, expert `[2.5, 5)`, killer `[5, 7)` (Kaggle 3M — see [#0032](DECISIONS.md) + [#0034](DECISIONS.md)). `killer` is intentionally hidden from the picker. Constraint added in migration 0012, renamed in 0013. |
| `givens` | smallint[81] | Starting clues. `0` = empty cell. |
| `solution` | smallint[81] | Unique solution. **Never sent to the client during multiplayer.** Single-player gets it via the SECURITY DEFINER RPC `sp_get_puzzle(code)` — see [#0022](DECISIONS.md). |
| `created_at` | timestamptz | |

#### `puzzles_public` (view)
Anon-readable projection of `puzzles`. Exposes `id`, `code`, `difficulty`, `givens`, `created_at`. **Solution is intentionally absent.** Originally created with `security_invoker = true` which made it inherit anon's lack of RLS allow on the underlying table and return zero rows; migration 0002 rebuilt it without `security_invoker` so the projection's whole point — anon can read the safe subset — actually works.

#### `puzzle_code_for(givens smallint[])` (function)
Pure SQL that computes the puzzle code. Same algorithm as `scripts/ingest/src/code.ts` so codes match across the in-DB backfill, the ingest insert path, and the in-repo sample pack. Test `code.test.ts` pins the algorithm; if you change one side, also update the other.

#### `sp_get_puzzle(p_code text)` (RPC)
SECURITY DEFINER. Returns the full row for a single puzzle including `solution`. Granted to `anon`. **Single-player only** — the comment on the function says so. Phase 2 multiplayer must use Edge Functions that take a room/player context and return only what that player is allowed to see.

### `rooms`
A multiplayer session. Created when a host clicks "Battle" or "Coop" and gets a shareable link.

| col | type | notes |
|---|---|---|
| `id` | uuid PK | Internal DB key, used by `moves.room_id` and channel naming. |
| `code` | text unique not null | Short shareable code in the URL (`/r/[code]`). 6 chars lowercase base36, randomly generated — see [DECISIONS.md #0021](DECISIONS.md). |
| `mode` | text | `battle` / `coop`. (`single` was dropped in migration 0004 — single-player doesn't use rooms; see [#0022](DECISIONS.md).) |
| `puzzle_code` | text FK → `puzzles(code)` | The puzzle this room is playing. Per [DECISIONS.md #0020](DECISIONS.md). Rotates on every round of a same-room replay cycle ([#0030](DECISIONS.md)). |
| `status` | text | `lobby` / `playing` / `finished`. Cycles back to `lobby` when players "Return to lobby" ([#0030](DECISIONS.md)). |
| `is_public` | boolean default false | Host toggle. Public rooms appear in the home page list ([#0029](DECISIONS.md)). |
| `winner_player_id` | uuid nullable | Battle mode only. Cleared on next-round start. |
| `settings` | jsonb not null default `{}` | Host-edited room settings (`showConflicts`, `autoCheck`, `highlightSameValue`); locks at Start. |
| `next_seq` | bigint not null default 1 | Per-room atomic move-seq counter. `submit-move` reserves via `reserve_room_seq` RPC (one `UPDATE … RETURNING` round-trip). Reset to 1 on each `start-game`. Added in migration 0014, see [DECISIONS #0036](DECISIONS.md). |
| `started_at` | timestamptz nullable | |
| `finished_at` | timestamptz nullable | Cleared on next-round start. |
| `created_at` | timestamptz | |

### `room_players`
A player's membership in a room. Anonymous; identified by `(room_id, player_id)` where `player_id` is the Supabase anon user ID.

| col | type | notes |
|---|---|---|
| `room_id` | uuid FK | |
| `player_id` | uuid | Supabase anon user ID. |
| `username` | text | User-chosen (defaults to a generated `adjective-noun`, persisted in localStorage; see [#0027](DECISIONS.md)). |
| `color` | text | Auto-assigned from the 8-color palette ([#0026](DECISIONS.md)). |
| `joined_at` | timestamptz | |
| `is_host` | boolean | |
| `progress_pct` | smallint | Cached % of non-given cells the player has *filled* (right or wrong). Updated by `submit-move`. Doesn't leak correctness — for that, the host enables `settings.autoCheck` and clients flag wrong cells from the per-move `cell_correct` response. Reset to 0 on each new round. |
| `has_returned` | boolean default true | Used by the return-to-lobby cycle ([#0030](DECISIONS.md)). Flipped to false when the room transitions `playing → finished`; flipped back to true when the player clicks "Return to lobby". The next-round Start blocks until all surviving members are `true`. |
| PK | (`room_id`, `player_id`) | |

### `moves`
The append-only log of player actions. This is the durable record; clients reconstruct state by replaying or applying snapshots.

| col | type | notes |
|---|---|---|
| `id` | bigserial PK | |
| `room_id` | uuid FK | |
| `player_id` | uuid | |
| `seq` | bigint | Per-room monotonic sequence. Used for ordering and last-write-wins. |
| `cell` | smallint | 0–80. |
| `kind` | text | `value` / `note_toggle` / `clear` |
| `value` | smallint nullable | 1–9 for `value` and `note_toggle`. |
| `client_move_id` | text nullable | Client-generated uuid for idempotent retries. Unique per (room_id, client_move_id) when non-null (partial index `moves_room_client_idem`). A dropped HTTP response can be safely retried with the same key. Added in migration 0014, see [DECISIONS #0036](DECISIONS.md). |
| `created_at` | timestamptz | |

In **battle mode**, each player has their own private board, so `moves` is partitioned by `player_id`. In **coop mode**, all moves apply to a single shared board.

### `player_completions`
One row per (player, puzzle) the player has ever completed. Source of truth for the home page "you've solved N puzzles" count and the "don't re-serve solved" filter. Per [DECISIONS #0028](DECISIONS.md).

| col | type | notes |
|---|---|---|
| `player_id` | uuid | Supabase anon user ID. |
| `puzzle_code` | text FK → `puzzles(code)` | |
| `mode` | text | `single` / `battle` / `coop` — the mode the player completed in. |
| `completed_at` | timestamptz not null default now() | |
| PK | (`player_id`, `puzzle_code`) | Dedupes re-solves. |

Inserted by `submit-move` on first multiplayer win and by an RPC `record_completion(p_code, p_mode)` for single-player. `on conflict do nothing` everywhere; we don't re-stamp the timestamp.

### `board_snapshots` (optional optimization)
For fast rejoin, we can persist the current materialized board state per room (coop) or per `(room_id, player_id)` (battle). Not required for V1 — we can always replay `moves` on join. Add if reconnect times feel slow.

---

## 5. Realtime sync model

We use **Supabase Realtime `postgres_changes` subscriptions**. In the V1 web client there are three subscriptions per room — `room_players:{id}`, `moves:{id}`, `rooms:{id}` — each filtered to that room. The original "one channel named `room:{room_id}` carrying three payload kinds" plan was dropped in favor of per-table subscriptions because that's what `postgres_changes` naturally produces and the quota cost (≤ 3 × concurrent rooms) is fine at our scale. Presence is not used in V1; the planned cursor visualization in coop will likely add it later.

### Optimistic UI + server-overlay store (May 2026, [DECISIONS #0036](DECISIONS.md))

Every multiplayer move flows through this loop:

1. Client generates a `client_move_id` (uuid) and applies the move to local state immediately.
   - **Battle** keeps a flat optimistic board (each player has a private board so there's nothing to converge with).
   - **Coop** keeps two boards: `remoteBoard` (materialized from server-confirmed moves in seq order) and `board` (`remoteBoard` with our own still-pending optimistic moves overlaid). The UI renders `board`.
2. Client `POST`s `submit-move` with `{room_id, cell, kind, value, client_move_id}`.
3. Server reserves the next seq atomically (`rooms.next_seq` via the `reserve_room_seq` RPC — one round-trip, no retry loop), inserts the move with the `client_move_id`, materializes the player's board (battle) or every move (coop) in seq order, and returns `{seq, progress_pct, won, ...}`.
4. The realtime channel delivers the moves row to every subscriber (the move's author included). The author's client recognizes the echo by `client_move_id` and removes the pending; non-authors fold the new move into `serverMoves` and rematerialize. Re-materializing from a seq-sorted Map is what makes LWW-by-seq actually hold regardless of the order realtime events arrive in.

### Idempotency, failure, and conflict handling

- **Retried HTTP requests** are safe — `submit-move` looks up `(room_id, client_move_id)` and returns the prior seq + state instead of inserting twice.
- **Submit failures** (rare; network or 5xx) trigger a **resync** on the client: fetch the room's authoritative move log (battle: own player only; coop: all moves), rebuild `remoteBoard`, drop the failed pending. The user sees the offending cell snap back to the server's truth with a brief toast.
- **Same-cell race in coop**: each client re-materializes from the seq-sorted log on every fold, so both clients converge to the higher-seq write. This was the failure mode of the original `dedup-by-player_id` design; the new `dedup-by-client_move_id` + seq-sorted re-materialization fixes it.
- **Coop undo** emits a server-side compensating move (clear / re-place / re-toggle) so peers see the revert. **Battle undo** stays local-only because the board is private; only the local progress bar briefly drifts, healed on the next legitimate move.

### Batching + delivery-recovery (see [DECISIONS #0037](DECISIONS.md))

Per-move HTTP+DB+realtime overhead made bursts of typing land slowly on peer devices. Two compounding changes:

- **Opportunistic client batching.** `apps/web/lib/move-batcher.ts` keeps a per-room queue: the first move fires immediately, and subsequent moves typed while a request is in flight accumulate and flush together as one batched `submit-move` call. No artificial delay for solo moves; bursts collapse into a single round-trip. Both `battle-store` and `coop-store` route through `enqueueMove(roomId, move)`.
- **Server batches in one transaction.** `submit-move` with `{moves: [...]}` reserves N seqs in one round-trip (`reserve_room_seqs` RPC, migration 0015), batch-inserts, materializes once, and returns per-move results. Cap = 200 moves/batch.

Because `postgres_changes` is not a perfectly reliable delivery channel under load, the coop client also has three resync triggers:

- **Seq-gap detection** — after every `applyRemoteMove`, the store checks if `serverMoves` has a hole (e.g., 1, 2, 4 but not 3). A debounced 500 ms timer fires a `resync()` if the hole persists; cancelled if a subsequent event fills it.
- **Realtime reconnect** — `subscribeToMoves` exposes a reconnect callback; `resync()` runs whenever the channel returns to `SUBSCRIBED` after a transient drop.
- **Tab visibility** — `coop-game.tsx` listens for `visibilitychange` and resyncs on return-to-visible (browsers throttle WebSockets in background tabs).

### Persistence vs. broadcast

- Persistent state (who's in the room, the move log, `next_seq`) is stored in Postgres and read on join.
- Live updates use the per-table `postgres_changes` subscriptions.
- On join, a client: (a) **subscribes first** (incoming events buffer into the store's `pendingRemote` until the board is built); (b) fetches `room`, `room_players`, `puzzle.givens`, and replays `moves` to reconstruct state; (c) hands the snapshot to `startCoop`/`startBattle` which drain the buffer in seq order. This subscribe-before-fetch ordering closes a small lost-event window in the original implementation.

---

## 6. Conflict resolution

### Battle mode
Each player has their own board. No conflicts possible. The server checks each `value` move against the puzzle's solution to determine completion — but **never sends the solution to the client**. The cell-correct check happens in a Supabase Edge Function or via an RLS-protected RPC.

### Coop mode
All players write to the same board. Decisions:

- **Last write wins per cell**, ordered by server-assigned `seq`. Two players setting cell (3,5) within 50ms of each other: whichever the server stamps with the higher `seq` wins. Both clients receive both events; both end up showing the winning value.
- **Notes are merged.** If player A toggles "3" in a cell's notes and player B toggles "5" at the same time, both notes end up set. Notes are per-cell sets; toggles are commutative on different values.
- **No edit locks.** Locking cells while a player "is thinking" creates UX friction (forgotten locks, unclear who's holding what). LWW + visible cursors is enough for V1.
- **Visible cursors.** Each player sees a colored highlight on every other player's currently-selected cell, broadcast via Presence. This is the primary "social awareness" mechanism that lets players naturally avoid stepping on each other.
- **Undo is local-only in V1.** Coop undo is hard (whose move are you undoing?). We sidestep by saying undo only reverts your own most recent move, and if someone else has touched that cell since, your undo has no effect on that cell.

### Game-over detection
Run on the server (Edge Function or trigger) by comparing the current materialized board against `puzzle.solution`. Server announces the winner on the channel; clients trust the server. Never put `solution` in client code.

---

## 7. Puzzle source

V1 uses the Kaggle [3 million Sudoku puzzles with ratings](https://www.kaggle.com/datasets/radcliffe/3-million-sudoku-puzzles-with-ratings) dataset (`radcliffe/3-million-sudoku-puzzles-with-ratings`). One row per puzzle: `id,puzzle,solution,clues,difficulty`. The rating column lets us bucket by the dataset's own difficulty without inferring from clue count. Per [DECISIONS.md #0018](DECISIONS.md), which supersedes #0011.

Ingest flow (`scripts/ingest/`, one-off):
1. Stream the CSV.
2. For each row, run our Norvig-ported solver to confirm a unique solution and that the dataset's claimed solution matches.
3. Bucket by the dataset's `difficulty` rating into easy / medium / hard / expert using the half-open bands in [#0032](DECISIONS.md). Rows whose rating sits above 7.0 are skipped entirely (no clue-count fallback). Per-(tier, clue-count) targets in `TARGET_PER_CELL` mean easy admits more high-clue puzzles, expert admits more low-clue ones. Stop sampling once every cell hits its target — currently 2,500 per tier (10,000 total).
4. Compute `puzzles.code = puzzleCodeFor(givens)` for every kept row (the TS port of the in-DB function — see [#0019](DECISIONS.md)).
5. Bulk insert into `puzzles` via the service-role client. The `unique(code)` constraint catches the impossible collision case.

Two read-only utility scripts complement the ingest:
- `pnpm --filter @sudoku-squad/ingest preflight:3m` — scan the source CSV and report rating + clue-count distributions, used to design `TARGET_PER_CELL`.
- `pnpm --filter @sudoku-squad/ingest audit:difficulty` — audit the live DB: per-tier counts, clue stats, and source-rating distribution by re-matching rows against the CSV.

Runtime never invokes the solver. Hints, auto-check, and win detection in single-player read `solution` via the RPC `sp_get_puzzle`; multiplayer hits Edge Functions instead — see [#0022](DECISIONS.md). The solver code lives in `scripts/ingest/` and is lint-blocked from being imported by `packages/core` or `apps/web`. Per [DECISIONS.md #0012](DECISIONS.md).

A real generator is a V2 project. The same Norvig implementation in `scripts/ingest/` would be the starting point.

---

## 8. Web → iOS port plan

This is *the* reason for the monorepo + shared core. To minimize porting work:

1. **All non-UI logic lives in `packages/core`.** Game state, validators, Supabase queries, channel handlers, move types. The web app imports from `core`; later, the iOS app does too.
2. **UI components are platform-specific** but small. The sudoku grid + number pad + room lobby are each one component file per platform. Expect ~600 lines of view code per platform total.
3. **Routing and navigation** are platform-specific (`next/router` vs. React Navigation). Keep route logic thin; push business logic into core hooks.
4. **Supabase SDK** has both JS and React Native packages with the same API surface. Same channel code on both sides.
5. **Cross-play in practice:** because both clients call the same `packages/core` functions for every game event, a web player and an iOS player in the same room will see identical state. We *should* still test it explicitly, but architecturally it's free.

### What NOT to put in `packages/core`
- Anything touching `document`, `window`, `localStorage`, or `next/*`.
- React components with platform-specific JSX (`<div>` vs `<View>`).
- Anything assuming a specific routing library.

If you need persistent client storage in core, accept it as an injected dependency:

```ts
interface KvStore { get(k: string): Promise<string|null>; set(k: string, v: string): Promise<void>; }
function createGameClient({ kv }: { kv: KvStore }) { /* ... */ }
```

Web passes a `localStorage`-backed impl; RN passes an `AsyncStorage`-backed impl.

---

## 9. Security & RLS notes

- Supabase Row-Level Security on every table.
- **`puzzles.solution` never leaves the server in multiplayer.** Anon can read `puzzles_public` (id, code, difficulty, givens, created_at); the underlying table is RLS-denied to anon. Migration 0002 fixed a `security_invoker = true` bug in the view that was silently denying anon reads.
- **Single-player is the only path that ships the solution to the client**, via the SECURITY DEFINER RPC `sp_get_puzzle(p_code)`. This is V1-only baggage; Phase 2 multiplayer must not call it. See [DECISIONS.md #0022](DECISIONS.md).
- `room_players` writable only when `player_id = auth.uid()`.
- `moves` insertable only by a current member of the room.
- Edge Function `submit_move` (Phase 2) validates the move against game rules before persisting + broadcasting.

`scripts/ingest/check-connectivity.ts` asserts the contract: anon can read `puzzles_public`, anon's direct read of `puzzles` returns 0 rows despite the ~10,000 real rows (RLS deny), and anon cannot request `solution` from the view at all (column doesn't exist there). Run it on every schema change.

This isn't paranoia — without server-authoritative move validation, anyone can DevTools their way to "I won battle mode."

---

## 10. Identifiers across modes (cheat sheet)

This is the part that most often confuses new contributors. There are five kinds of identifier in play:

| What | Type | Where it lives | Used for |
|---|---|---|---|
| Puzzle DB key | uuid | `puzzles.id` | internal PK; not exposed client-side |
| **Puzzle code** | text (6-char base36) | `puzzles.code` | URL slug `/play/[code]`, FK from `rooms.puzzle_code`, `BoardState.puzzleCode`, in-repo sample pinning |
| Room DB key | uuid | `rooms.id` | move-log scope, realtime channel name `room:{room_id}` |
| **Room code** | text (6-char base36, random) | `rooms.code` | URL slug `/r/[code]`, what users share with friends |
| Player | uuid | Supabase `auth.uid()` | `room_players.player_id`, `moves.player_id` |

The two `code` columns share a format but live in independent tables and URL namespaces. Per [DECISIONS.md #0019](DECISIONS.md), #0020, #0021.

---

## 11. Edge Functions (Phase 2+)

Per [DECISIONS.md #0023](DECISIONS.md), multiplayer mutations go through TypeScript Edge Functions, not SQL RPCs. Each function lives at `supabase/functions/<name>/`, uses the service-role client to bypass RLS, and is the authority for its mutation.

| Function | Input | Output | Status |
|---|---|---|---|
| `create-room` | `{mode, difficulty, username, is_public?}` | `{room_id, room_code, player_id, color, mode, puzzle_code}` | ✅ deployed |
| `join-room` | `{code, username}` | `{room_id, room_code, mode, status, puzzle_code, player_id, color, is_host, rejoined}` | ✅ deployed |
| `start-game` | `{room_id}` | `{status: 'playing', started_at, puzzle_code}` | ✅ deployed — extended to handle next-round reset per [#0030](DECISIONS.md) |
| `submit-move` | Single: `{room_id, cell, kind, value, client_move_id?}`. Batch (preferred): `{room_id, moves: [...]}`. | Single: `{seq, accepted, progress_pct, won, is_winner, idempotent?, cell_correct?}`. Batch: `{results: [{seq, idempotent?, cell_correct?}], progress_pct, won, is_winner, shared_win?}`. | ✅ rewritten 2026-05-23 per [#0036](DECISIONS.md) + extended for batches per [#0037](DECISIONS.md). Atomic `reserve_room_seq` / `reserve_room_seqs` RPCs, parallel reads, client_move_id idempotency, batch cap 200. `cell_correct` returned only when `settings.autoCheck` is on. |
| `claim-username` | `{}` | `{username}` | ✅ deployed — idempotent per `auth.uid()`; backed by `issued_usernames` (migration 0008) |
| `update-room-settings` | `{room_id, settings}` | `{settings}` | ✅ deployed — host-only, lobby-only |
| `change-difficulty` | `{room_id, difficulty}` | `{puzzle_code, difficulty}` | ✅ deployed — host-only, lobby-only. Re-picks a random puzzle of the new tier; `killer` is intentionally rejected by the input validator. See [#0035](DECISIONS.md). |
| `kick-player` | `{room_id, player_id}` | `{kicked: true}` | ✅ deployed — host-only |
| `return-to-lobby` | `{room_id}` | `{status, has_returned: true}` | ✅ deployed — flips caller's `has_returned`; transitions room to `lobby` if not already |
| `record_completion` (RPC) | `(p_code, p_mode)` → bool | inserts `player_completions` with `on conflict do nothing`. SECURITY DEFINER. | ✅ deployed (migration 0009) |
| `get_completion_count` (RPC) | `()` → int | reads caller's row count. SECURITY DEFINER. | ✅ deployed (migration 0009) |
| `hint` | (removed for V1) | — | dropped per the May 22 product changes |

`submit-move` does the work that `check-completion` was originally going to do — inline progress + atomic winner update. The `where status = 'playing'` guard is the tiebreak for near-simultaneous winning moves.

Shared helpers in `supabase/functions/_shared/`:
- `cors.ts` — preflight + headers
- `errors.ts` — typed error response shape `{ error: { code, message } }`
- `supabase.ts` — `serviceClient()` (admin), `callerClient(authHeader)` (JWT-bound), `getCallerUserId(req)`
- `room-code.ts` — random 6-char base36 generator + color palette helpers

The web client invokes via `supabase.functions.invoke(name, { body })` after `ensureAuthClient()` has signed the visitor in anonymously.

---

## 12. Open architectural questions

See the live list in [DECISIONS.md](DECISIONS.md) → "Open questions (live)". The biggest ones blocking Phase 2:

- **Edge Function vs. Postgres RPC for `submit_move`** — leaning Edge Function for TS flexibility and to match `create_room`/`join_room`. Decide before the first one lands.
- **Mid-game join behavior** — working assumption: battle locks at Start, coop is open anytime. Confirm before the lobby UI ships.
- **Disconnect grace period** — 60 s vs 2 minutes; affects how the lobby renders absent players.
- **Presence cursor frequency** — throttle to ~10/s to avoid Realtime quota; not a question, a constraint to remember.

Deferred / V2: `board_snapshots`, host migration acknowledgement UX, mobile cursor visualization in coop.
