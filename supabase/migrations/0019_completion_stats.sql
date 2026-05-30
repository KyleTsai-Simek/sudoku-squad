-- ============================================================================
-- 0019_completion_stats.sql
--
-- Per-difficulty completion stats for the caller. Backend capture for the
-- authenticated-accounts feature ([DECISIONS.md #0043]) — no profile/stats UI
-- ships this iteration, but the data is surfaced via this RPC so it's ready.
--
-- "Unique solved puzzle hashes" are already the `puzzle_code` values in
-- `player_completions` (backend-only; never shown to the client). This RPC
-- aggregates them per difficulty by joining to `puzzles.difficulty`. The
-- existing `get_completion_count()` (migration 0009) still returns the grand
-- total. Returns only difficulties with >= 1 solve; the client fills zeros.
-- ============================================================================

create or replace function public.get_completion_stats()
returns table (difficulty text, solved integer)
language sql
security definer
stable
set search_path = public
as $$
  select p.difficulty, count(*)::integer as solved
  from public.player_completions pc
  join public.puzzles p on p.code = pc.puzzle_code
  where pc.player_id = auth.uid()
  group by p.difficulty;
$$;

revoke all on function public.get_completion_stats() from public;
grant execute on function public.get_completion_stats()
  to anon, authenticated;
