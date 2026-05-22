# Supabase

SQL migrations and (Phase 2+) Edge Functions for the Sudoku Squad backend.

## Migrations

Numbered files in `migrations/` apply in order. Each one is a complete SQL script that should apply cleanly to a fresh database.

### Currently applied

| File | What it does |
|---|---|
| `0001_initial.sql` | Tables: `puzzles`, `rooms`, `room_players`, `moves`. `puzzles_public` view. First RLS policies. |
| `0002_puzzles_public_security_definer.sql` | Re-creates `puzzles_public` without `security_invoker = true` — the original setting made the view inherit anon's lack of RLS allow on `puzzles` and return zero rows. |
| `0003_puzzle_code_and_sp_rpc.sql` | Adds `puzzles.code` (6-char base36 hash of givens, unique, indexed). Backfills via PL/pgSQL `puzzle_code_for(smallint[])`. Updates `puzzles_public` to expose `code`. Adds SECURITY DEFINER RPC `sp_get_puzzle(p_code)` for single-player. |
| `0004_rooms_puzzle_code_fk.sql` | Drops `rooms.puzzle_id` (uuid FK) in favor of `rooms.puzzle_code` (text FK → `puzzles.code`). Drops `single` from the `rooms.mode` CHECK constraint. See [DECISIONS.md #0020 / #0022](../docs/DECISIONS.md). |
| `0005_pick_random_puzzle_code.sql` | SECURITY DEFINER RPC `pick_random_puzzle_code(difficulty)`. Used by `create-room` to assign a puzzle to a new room. |
| `0006_fix_room_players_rls_recursion.sql` | Replaces the recursive `room_players_read_member` policy with one that goes through a SECURITY DEFINER `is_room_member(room_id)` helper. Same fix applied to `moves_read_member`. |
| `0007_realtime_publications.sql` | Adds `room_players`, `moves`, `rooms` to the `supabase_realtime` publication so the client can subscribe to `postgres_changes` for live lobby/game updates. |

### Running locally

The Supabase CLI is the preferred path now that we're past Phase 0:

```bash
# One-time setup
brew install supabase/tap/supabase
supabase link --project-ref <ref>       # ref is in .env.local → SUPABASE_URL host

# Apply any unapplied migrations
supabase db push --linked
```

For a fresh project that's never seen any migration, the same command applies all four. For our existing project the CLI already has `0001..0004` tracked.

If you've manually applied a migration via the SQL editor and the CLI doesn't know about it, mark it as applied:

```bash
supabase migration repair --status applied <NNNN> --linked
```

### Functions and RPCs created by migrations

Documented in [docs/ARCHITECTURE.md §4](../docs/ARCHITECTURE.md):

- `puzzle_code_for(smallint[]) → text` — deterministic puzzle-code hash.
- `sp_get_puzzle(p_code text) → table(...)` — single-player only; returns full row including solution.

## Edge Functions

Live in `supabase/functions/`. Each function lives in its own directory; `_shared/` holds CORS, error helpers, Supabase client constructors, and the random-code generator. Per [DECISIONS.md #0023](../docs/DECISIONS.md), all multiplayer mutations go through Edge Functions (not SQL RPCs).

| Function | Status | Purpose |
|---|---|---|
| `create-room` | Deployed | Pick a random puzzle, generate a room code, insert the room + host as the first player. |
| `join-room` | Deployed | Look up by code; enforce mid-game-join policy ([#0024](../docs/DECISIONS.md)); assign color; idempotent on rejoin. |
| `start-game` | Deployed | Host-only transition `lobby → playing`. Validates ≥ 2 players in battle. |
| `submit-move` | Deployed | Validate input + game state, assign next per-room `seq`, insert into `moves`. Replays the caller's moves to compute progress %, caches it, and atomically promotes them to winner if their board now matches the solution (with a `where status='playing'` guard for ties). |
| `hint` | Pending | Per-cell reveal for multiplayer. |

### Deploying

```bash
supabase functions deploy create-room --use-api    # one function
# or deploy all
supabase functions deploy --use-api
```

`--use-api` does the bundling on Supabase's servers (no Docker required locally). JWT verification is on by default; the caller's anonymous JWT is required.

### Local dev

```bash
supabase functions serve <name>     # serves at http://127.0.0.1:54321/functions/v1/<name>
```

Requires `supabase start` (which needs Docker) for the local Postgres/Realtime stack. We mostly skip this and deploy straight to the linked project for now.
