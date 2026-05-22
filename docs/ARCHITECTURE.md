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
      app/                # routes: / and /play/[code]
      components/         # SudokuBoard, NumberPad, Timer, SettingsSheet, etc.
      lib/                # game-store (zustand), puzzle-source, pick-puzzle,
                          # solved-tracker, supabase, sample-puzzles
      e2e/                # Playwright smoke
    ios/                  # Expo / React Native (added in Phase 4)
  packages/
    core/                 # SHARED — must stay platform-agnostic
      src/
        puzzle/           # board construction, conflict detection (NO solver)
        game/             # reducer, notes bitmask helpers, undo/redo history
        types/            # shared TS types
                          # (sync/ will be created in Phase 2)
  scripts/
    ingest/               # one-off: dataset import, Norvig solver, code hashing
      data/               # gitignored: source CSVs from Kaggle
      fixtures/           # small in-repo synthetic CSVs (committed)
      src/                # solver, csv reader, code hash, check-connectivity
  supabase/
    migrations/           # 0001..0004 applied to live project
    functions/            # Edge Functions (Phase 2)
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

Live SQL is in `supabase/migrations/`. Tables below reflect what's actually applied to the project (migrations 0001 → 0004).

### `puzzles`
Pre-generated puzzles. Immutable once ingested. 7 500 rows live as of this writing — 2 500 each in easy / medium / hard.

| col | type | notes |
|---|---|---|
| `id` | uuid PK | Internal DB key. Not visible client-side. |
| `code` | text unique not null | 6-char lowercase base36 hash of `givens`. URL slug and the cross-mode puzzle identifier. Per [DECISIONS.md #0019](DECISIONS.md). |
| `difficulty` | text | `easy` / `medium` / `hard` / `expert`. V1 ships easy/medium/hard (expert is currently empty by design — see [#0018](DECISIONS.md)). |
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

We use **Supabase Realtime channels**, one per room. Channel name: `room:{room_id}`.

Three kinds of payloads on the channel:

1. **`move`** — a player made a move. Subscribers apply it to local state.
2. **`presence`** — cursor position, selected cell, online status. Uses Supabase Presence (ephemeral, not persisted).
3. **`game_event`** — room-level transitions: `game_started`, `game_finished`, `player_joined`, `player_left`.

### Optimistic UI

The client applies its own moves immediately, then sends them to the server. When the server echoes the move back through the channel (with the assigned `seq`), the client reconciles. If the server rejects (e.g., game already finished), client rolls back.

### Persistence vs. broadcast

- Persistent state (who's in the room, the move log) is stored in Postgres and read on join.
- Live updates use Realtime channels.
- On join, a client: (a) fetches `room`, `room_players`, `puzzle.givens`, and replays `moves` to reconstruct state; (b) subscribes to the channel.

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
3. Bucket by the dataset's `difficulty` rating into easy / medium / hard / expert. Stop sampling once each tier hits its target (currently 2 500 each except expert = 0).
4. Compute `puzzles.code = puzzleCodeFor(givens)` for every kept row (the TS port of the in-DB function — see [#0019](DECISIONS.md)).
5. Bulk insert into `puzzles` via the service-role client. The `unique(code)` constraint catches the impossible collision case.

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

`scripts/ingest/check-connectivity.ts` asserts the contract: anon can read `puzzles_public`, anon's direct read of `puzzles` returns 0 rows despite 7 500 real rows (RLS deny), and anon cannot request `solution` from the view at all (column doesn't exist there). Run it on every schema change.

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
| `submit-move` | `{room_id, cell, kind, value}` | `{seq, accepted, progress_pct, won, is_winner, cell_correct?}` | ✅ deployed — `cell_correct` returned only when `settings.autoCheck` is on |
| `update-room-settings` | `{room_id, settings}` | `{settings}` | pending (host-only, lobby-only) |
| `kick-player` | `{room_id, player_id}` | `{kicked: true}` | pending (host-only) |
| `return-to-lobby` | `{room_id}` | `{status, has_returned: true}` | pending |
| `record-completion` (RPC) | `(p_code, p_mode)` → bool | inserts `player_completions` with `on conflict do nothing`. SECURITY DEFINER. | pending |
| `get-completion-count` (RPC) | `()` → int | reads caller's row count. SECURITY DEFINER. | pending |
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
