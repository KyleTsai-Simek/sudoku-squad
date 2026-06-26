-- ============================================================================
-- 0020_daily_puzzles.sql
--
-- Daily puzzle rotation + richer completion metadata.
--
-- A Pacific calendar day has one puzzle each for easy / medium / hard. The
-- assignment function prefers puzzles nobody has solved yet, falling back to
-- the full tier only when a tier has no globally-unsolved puzzles remaining.
-- ============================================================================

alter table public.player_completions
  add column if not exists solve_time_ms integer
    check (solve_time_ms is null or solve_time_ms >= 0);

create table if not exists public.daily_puzzles (
  puzzle_date date not null,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  puzzle_code text not null references public.puzzles(code) on update cascade,
  selected_at timestamptz not null default now(),
  primary key (puzzle_date, difficulty),
  unique (puzzle_date, puzzle_code)
);

create index if not exists daily_puzzles_code_idx
  on public.daily_puzzles (puzzle_code);

alter table public.daily_puzzles enable row level security;

create policy "daily_puzzles_read_all"
  on public.daily_puzzles for select
  to anon, authenticated
  using (true);

create table if not exists public.player_daily_completions (
  player_id uuid not null,
  puzzle_date date not null,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  puzzle_code text not null references public.puzzles(code) on update cascade,
  completed_at timestamptz not null default now(),
  solve_time_ms integer check (solve_time_ms is null or solve_time_ms >= 0),
  created_at timestamptz not null default now(),
  primary key (player_id, puzzle_date, difficulty)
);

create index if not exists player_daily_completions_player_idx
  on public.player_daily_completions (player_id);

create index if not exists player_daily_completions_leaderboard_idx
  on public.player_daily_completions (puzzle_date, difficulty, solve_time_ms)
  where solve_time_ms is not null;

alter table public.player_daily_completions enable row level security;

create policy "player_daily_completions_read_self"
  on public.player_daily_completions for select
  to anon, authenticated
  using (player_id = auth.uid());

create or replace function public.current_pacific_date()
returns date
language sql
stable
as $$
  select (now() at time zone 'America/Los_Angeles')::date;
$$;

create or replace function public.assign_daily_puzzles(p_date date default public.current_pacific_date())
returns table (puzzle_date date, difficulty text, puzzle_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  d text;
  picked text;
  day date := coalesce(p_date, public.current_pacific_date());
begin
  perform pg_advisory_xact_lock(hashtext('daily_puzzles:' || day::text));

  foreach d in array array['easy', 'medium', 'hard'] loop
    select dp.puzzle_code
      into picked
    from public.daily_puzzles dp
    where dp.puzzle_date = day
      and dp.difficulty = d;

    if picked is null then
      select p.code
        into picked
      from public.puzzles p
      where p.difficulty = d
      order by
        exists (
          select 1
          from public.player_completions pc
          where pc.puzzle_code = p.code
        ) asc,
        random()
      limit 1;

      if picked is null then
        raise exception 'no puzzle available for difficulty %', d;
      end if;

      insert into public.daily_puzzles (puzzle_date, difficulty, puzzle_code)
      values (day, d, picked)
      on conflict (puzzle_date, difficulty) do nothing;
    end if;
  end loop;

  return query
    select dp.puzzle_date, dp.difficulty, dp.puzzle_code
    from public.daily_puzzles dp
    where dp.puzzle_date = day
    order by array_position(array['easy', 'medium', 'hard'], dp.difficulty);
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
  select a.puzzle_date, a.difficulty, a.puzzle_code, p.givens
  from assigned a
  join public.puzzles p on p.code = a.puzzle_code
  order by array_position(array['easy', 'medium', 'hard'], a.difficulty);
$$;

revoke all on function public.get_daily_puzzles(date) from public;
grant execute on function public.get_daily_puzzles(date)
  to anon, authenticated;

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
  daily_matches boolean := false;
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

  if p_daily_date is not null then
    select exists (
      select 1
      from public.daily_puzzles dp
      where dp.puzzle_date = p_daily_date
        and dp.difficulty = p_daily_difficulty
        and dp.puzzle_code = p_code
        and dp.puzzle_date = public.current_pacific_date()
    ) into daily_matches;

    if daily_matches then
      insert into public.player_daily_completions (
        player_id,
        puzzle_date,
        difficulty,
        puzzle_code,
        solve_time_ms
      )
      values (uid, p_daily_date, p_daily_difficulty, p_code, p_solve_time_ms)
      on conflict (player_id, puzzle_date, difficulty) do update
        set solve_time_ms = coalesce(
              public.player_daily_completions.solve_time_ms,
              excluded.solve_time_ms
            );
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.record_single_player_completion(text, integer, date, text)
  from public;
grant execute on function public.record_single_player_completion(text, integer, date, text)
  to anon, authenticated;

comment on table public.daily_puzzles is
  'Pacific-day daily puzzle assignments: one puzzle each for easy, medium, and hard.';

comment on table public.player_daily_completions is
  'Per-player daily puzzle completions, only counted when solved on the assigned Pacific day.';

comment on column public.player_completions.solve_time_ms is
  'Elapsed solve time for the first recorded completion when known.';
