-- ============================================================================
-- 0021_fix_daily_puzzles_rpc_ambiguity.sql
--
-- Fix PL/pgSQL name ambiguity in the daily assignment RPC. The original
-- `assign_daily_puzzles` returned columns named exactly like table columns
-- (`puzzle_date`, `difficulty`, `puzzle_code`), which made Postgres treat some
-- references as ambiguous between output variables and table columns.
-- ============================================================================

drop function if exists public.get_daily_puzzles(date);
drop function if exists public.assign_daily_puzzles(date);

create or replace function public.assign_daily_puzzles(
  p_date date default public.current_pacific_date()
)
returns table (daily_date date, daily_difficulty text, daily_puzzle_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_difficulty text;
  picked_code text;
  target_date date := coalesce(p_date, public.current_pacific_date());
begin
  perform pg_advisory_xact_lock(hashtext('daily_puzzles:' || target_date::text));

  foreach target_difficulty in array array['easy', 'medium', 'hard'] loop
    select existing.puzzle_code
      into picked_code
    from public.daily_puzzles as existing
    where existing.puzzle_date = target_date
      and existing.difficulty = target_difficulty;

    if picked_code is null then
      select candidate.code
        into picked_code
      from public.puzzles as candidate
      where candidate.difficulty = target_difficulty
      order by
        exists (
          select 1
          from public.player_completions as completion
          where completion.puzzle_code = candidate.code
        ) asc,
        random()
      limit 1;

      if picked_code is null then
        raise exception 'no puzzle available for difficulty %', target_difficulty;
      end if;

      insert into public.daily_puzzles (puzzle_date, difficulty, puzzle_code)
      values (target_date, target_difficulty, picked_code)
      on conflict on constraint daily_puzzles_pkey do nothing;
    end if;
  end loop;

  return query
    select assigned.puzzle_date, assigned.difficulty, assigned.puzzle_code
    from public.daily_puzzles as assigned
    where assigned.puzzle_date = target_date
    order by array_position(array['easy', 'medium', 'hard'], assigned.difficulty);
end;
$$;

revoke all on function public.assign_daily_puzzles(date) from public;
grant execute on function public.assign_daily_puzzles(date)
  to anon, authenticated, service_role;

create or replace function public.get_daily_puzzles(p_date date default null)
returns table (
  puzzle_date date,
  difficulty text,
  puzzle_code text,
  givens smallint[]
)
language sql
security definer
set search_path = public
as $$
  with assigned as (
    select *
    from public.assign_daily_puzzles(coalesce(p_date, public.current_pacific_date()))
  )
  select
    assigned.daily_date as puzzle_date,
    assigned.daily_difficulty as difficulty,
    assigned.daily_puzzle_code as puzzle_code,
    puzzle.givens
  from assigned
  join public.puzzles as puzzle on puzzle.code = assigned.daily_puzzle_code
  order by array_position(array['easy', 'medium', 'hard'], assigned.daily_difficulty);
$$;

revoke all on function public.get_daily_puzzles(date) from public;
grant execute on function public.get_daily_puzzles(date)
  to anon, authenticated;
