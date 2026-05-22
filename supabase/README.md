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

Not yet created. Phase 2 adds `create_room`, `join_room`, `submit_move`, `check_completion`, and `hint`. They'll live in `supabase/functions/` per Supabase's standard layout. See [docs/ROADMAP.md → Phase 2](../docs/ROADMAP.md) and [docs/TODO.md](../docs/TODO.md).
