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
| Package manager | **pnpm 9** (workspaces) | Strict dep resolution enforces the `packages/core` purity rule. Per [DECISIONS.md #0014](DECISIONS.md). |

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
    web/                  # Next.js
      app/
      components/
      lib/                # web-only adapters (e.g., useRouter)
    ios/                  # Expo / React Native (added in Phase 4)
  packages/
    core/                 # SHARED — must stay platform-agnostic
      src/
        puzzle/           # validation, conflict detection (NO solver — that's in scripts/)
        game/             # state machine, reducers, move types
        sync/             # Supabase channel helpers, conflict rules
        types/            # shared TS types
    ui/                   # (optional later) shared design tokens
  scripts/
    ingest/               # one-off: dataset import, Norvig solver, uniqueness checks
  supabase/
    migrations/           # SQL migrations
    functions/            # Edge Functions (validation, room creation)
  docs/
  package.json
  pnpm-workspace.yaml
```

**Critical rule:** `packages/core` must not import from `next/*`, `react-native/*`, `react-dom/*`, or any DOM API. It can use `react` (for hooks like `useState` if needed) since both clients ship React.

---

## 4. Data model (Supabase / Postgres)

Schema sketch — final SQL lives in `supabase/migrations/`.

### `puzzles`
Pre-generated puzzles. Mined or generated; immutable.

| col | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `difficulty` | text | `easy` / `medium` / `hard` / `expert` (V1: `medium` only) |
| `givens` | int[81] | The starting clues. `0` = empty cell. |
| `solution` | int[81] | The unique solution. Never sent to client during play. |
| `created_at` | timestamptz | |

### `rooms`
A multiplayer session. Created when a host clicks "Battle" or "Coop" and gets a shareable link.

| col | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `code` | text unique | Short shareable code in the URL (e.g., `/r/abc123`). |
| `mode` | text | `single` / `battle` / `coop` |
| `puzzle_id` | uuid FK → puzzles | |
| `status` | text | `lobby` / `playing` / `finished` |
| `winner_player_id` | uuid nullable | Battle mode only. |
| `started_at` | timestamptz nullable | |
| `finished_at` | timestamptz nullable | |
| `created_at` | timestamptz | |

### `room_players`
A player's membership in a room. Anonymous; identified by `(room_id, player_id)` where `player_id` is the Supabase anon user ID.

| col | type | notes |
|---|---|---|
| `room_id` | uuid FK | |
| `player_id` | uuid | Supabase anon user ID. |
| `username` | text | User-chosen, scoped to this room. |
| `color` | text | Auto-assigned for cursor/UI. |
| `joined_at` | timestamptz | |
| `is_host` | boolean | |
| `progress_pct` | smallint | Battle mode: cached % of cells correctly filled. |
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

**V1 uses the Kaggle 9M Sudoku dataset** (or the 1M variant if it's easier to download). Plain CSV, one row per puzzle: `puzzle,solution[,difficulty]`. Per [DECISIONS.md #0011](DECISIONS.md).

Ingest flow (`scripts/ingest/`, one-off):
1. Stream the CSV.
2. For each row, run our Norvig-ported solver against `puzzle` to confirm it has exactly one solution. Reject any row with zero or multiple solutions, or where the dataset's claimed `solution` doesn't match.
3. Pick 500–1000 medium-difficulty rows. Upsert into `puzzles` with `givens` and `solution`.
4. Done. The script is never run at runtime.

Runtime never invokes the solver. Hints, auto-check, and win detection all read `puzzles.solution` directly (server-side; never sent to the client). The solver code lives in `scripts/`, not `packages/core`. Per [DECISIONS.md #0012](DECISIONS.md).

A real generator is a V2 project. If we ever want one, the same Norvig implementation in `scripts/` is the starting point.

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
- `puzzles.solution` is **server-only** — readable by `service_role` and Edge Functions, never by `anon`.
- `room_players` writable only when `player_id = auth.uid()`.
- `moves` insertable only by a current member of the room.
- Edge Function `submit_move` validates the move against game rules before persisting + broadcasting.

This isn't paranoia — without server-authoritative move validation, anyone can DevTools their way to "I won battle mode."

---

## 10. Open architectural questions

- **Do we need `board_snapshots`?** Probably defer until rejoin latency becomes an issue.
- **Edge Function vs. Postgres RPC for move submission?** Both work. RPC is simpler if all logic is SQL-expressible; Edge Function gives us TS. Likely Edge Function.
- **Presence cursor frequency.** Need to throttle to ~10/s to avoid Realtime quota issues.
- **What happens when the host leaves mid-game?** Probably: host title transfers to the longest-tenured remaining player; game continues. Decide before coop ships.

See [DECISIONS.md](DECISIONS.md) for resolved decisions and the running open-questions list.
