-- ============================================================================
-- 0009_player_completions.sql
--
-- Server-side per-player puzzle completion tracking. One row per
-- (player, puzzle). Source of truth for the home page "you've solved N
-- puzzles" count and the "don't re-serve solved" filter. Per [DECISIONS.md
-- #0028].
--
-- Inserted by:
--   - submit-move (when a multiplayer player's board first matches solution).
--   - record_completion(p_code, p_mode) RPC, called by the SP CompletionOverlay.
-- Both use ON CONFLICT DO NOTHING — re-solves don't duplicate.
-- ============================================================================

create table if not exists public.player_completions (
  player_id    uuid not null,
  puzzle_code  text not null references public.puzzles(code) on update cascade,
  mode         text not null check (mode in ('single', 'battle', 'coop')),
  completed_at timestamptz not null default now(),
  primary key (player_id, puzzle_code)
);

create index if not exists player_completions_player_idx
  on public.player_completions (player_id);

alter table public.player_completions enable row level security;

-- Anon can read their own completions (used by the home page count + the
-- "don't re-serve solved" filter).
create policy "player_completions_read_self"
  on public.player_completions for select
  to anon, authenticated
  using (player_id = auth.uid());
-- No client insert/delete policies — all writes go through the Edge Function
-- (service-role) or the SECURITY DEFINER RPCs below.

-- RPC: record a completion for the caller.
create or replace function public.record_completion(p_code text, p_mode text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'unauthenticated';
  end if;
  if p_mode not in ('single', 'battle', 'coop') then
    raise exception 'invalid mode';
  end if;
  insert into public.player_completions (player_id, puzzle_code, mode)
  values (uid, p_code, p_mode)
  on conflict (player_id, puzzle_code) do nothing;
  return true;
end;
$$;

revoke all on function public.record_completion(text, text) from public;
grant execute on function public.record_completion(text, text)
  to anon, authenticated;

-- RPC: read the caller's completion count.
create or replace function public.get_completion_count()
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::integer
  from public.player_completions
  where player_id = auth.uid();
$$;

revoke all on function public.get_completion_count() from public;
grant execute on function public.get_completion_count()
  to anon, authenticated;

comment on table public.player_completions is
  'Per-player puzzle completion log. Source of truth for the home page count.';
