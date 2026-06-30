-- Make daily completion credit independent of client-carried daily metadata.
-- The client may resume a local single-player snapshot that predates the daily
-- URL metadata; the server should still grant daily credit when the completed
-- puzzle is one of today's Pacific daily assignments.

create or replace function public.record_single_player_completion(
  p_code text,
  p_solve_time_ms integer default null,
  p_daily_date date default null,
  p_daily_difficulty text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  matched_daily_date date;
  matched_daily_difficulty text;
begin
  if uid is null then
    raise exception 'unauthenticated';
  end if;
  if p_solve_time_ms is not null and p_solve_time_ms < 0 then
    raise exception 'invalid solve time';
  end if;
  if (p_daily_date is null) <> (p_daily_difficulty is null) then
    raise exception 'daily date and difficulty must be provided together';
  end if;
  if p_daily_difficulty is not null and p_daily_difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'invalid daily difficulty';
  end if;

  insert into public.player_completions (player_id, puzzle_code, mode, solve_time_ms)
  values (uid, p_code, 'single', p_solve_time_ms)
  on conflict (player_id, puzzle_code) do update
    set solve_time_ms = coalesce(public.player_completions.solve_time_ms, excluded.solve_time_ms);

  select dp.puzzle_date, dp.difficulty
    into matched_daily_date, matched_daily_difficulty
  from public.daily_puzzles dp
  where dp.puzzle_code = p_code
    and dp.puzzle_date = public.current_pacific_date()
  limit 1;

  if matched_daily_date is not null then
    insert into public.player_daily_completions (
      player_id,
      puzzle_date,
      difficulty,
      puzzle_code,
      solve_time_ms
    )
    values (uid, matched_daily_date, matched_daily_difficulty, p_code, p_solve_time_ms)
    on conflict (player_id, puzzle_date, difficulty) do update
      set solve_time_ms = coalesce(
            public.player_daily_completions.solve_time_ms,
            excluded.solve_time_ms
          );
  end if;

  return true;
end;
$$;

revoke all on function public.record_single_player_completion(text, integer, date, text)
  from public;
grant execute on function public.record_single_player_completion(text, integer, date, text)
  to anon, authenticated;
