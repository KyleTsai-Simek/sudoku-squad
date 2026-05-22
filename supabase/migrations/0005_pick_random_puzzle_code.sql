-- ============================================================================
-- 0005_pick_random_puzzle_code.sql
--
-- Tiny helper used by the create-room Edge Function. Returns the code of a
-- random puzzle of the requested difficulty, or null if none exist. SECURITY
-- DEFINER so it can read `puzzles` even though anon lacks direct grant; the
-- function only returns the code (not the solution).
--
-- For 7 500 rows, `order by random() limit 1` is ~milliseconds. Don't optimize
-- until we have 10x the data.
-- ============================================================================

create or replace function public.pick_random_puzzle_code(p_difficulty text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select code
  from public.puzzles
  where difficulty = p_difficulty
  order by random()
  limit 1;
$$;

revoke all on function public.pick_random_puzzle_code(text) from public;
grant execute on function public.pick_random_puzzle_code(text) to anon, authenticated, service_role;

comment on function public.pick_random_puzzle_code(text) is
  'Returns a random puzzle code of the given difficulty. Used by create-room Edge Function. Never returns solution.';
