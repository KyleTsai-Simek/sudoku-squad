-- ============================================================================
-- 0025_completion_leaderboard_include_zero_current.sql
--
-- Include the caller's own leaderboard row even when they have zero completed
-- puzzles. The row is given the next rank after all players with completions;
-- the home UI pins it above the top list so a brand-new player can still see
-- their place immediately.
-- ============================================================================

create or replace function public.get_completion_leaderboard(
  p_limit integer default 15,
  p_offset integer default 0,
  p_leaderboard_key text default 'total_completions'
)
returns table (
  leaderboard_key text,
  rank_position integer,
  player_id uuid,
  username text,
  completed_count integer,
  is_current_user boolean,
  total_ranked_players integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  page_limit integer := least(greatest(coalesce(p_limit, 15), 1), 100);
  page_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if p_leaderboard_key <> 'total_completions' then
    raise exception 'unsupported leaderboard key: %', p_leaderboard_key;
  end if;

  return query
  with player_totals as (
    select
      pc.player_id,
      count(*)::integer as completed_count,
      max(pc.completed_at) as last_completed_at
    from public.player_completions pc
    group by pc.player_id
  ),
  ranked_completions as (
    select
      row_number() over (
        order by
          pt.completed_count desc,
          pt.last_completed_at asc,
          pt.player_id asc
      )::integer as rank_position,
      pt.player_id,
      pt.completed_count
    from player_totals pt
  ),
  ranked as (
    select
      rc.rank_position,
      rc.player_id,
      rc.completed_count,
      greatest(
        count(*) over (),
        case when rc.player_id = uid then count(*) over () else 0 end
      )::integer as total_ranked_players
    from ranked_completions rc
    union all
    select
      (select count(*)::integer + 1 from ranked_completions) as rank_position,
      uid as player_id,
      0 as completed_count,
      (select count(*)::integer + 1 from ranked_completions) as total_ranked_players
    where uid is not null
      and not exists (
        select 1 from ranked_completions rc where rc.player_id = uid
      )
  ),
  page_rows as (
    select *
    from ranked r
    where r.completed_count > 0
      and r.rank_position > page_offset
      and r.rank_position <= page_offset + page_limit
  ),
  selected_rows as (
    select * from page_rows
    union
    select r.*
    from ranked r
    where uid is not null
      and r.player_id = uid
      and not exists (
        select 1 from page_rows p where p.player_id = r.player_id
      )
  )
  select
    p_leaderboard_key as leaderboard_key,
    sr.rank_position,
    sr.player_id,
    coalesce(iu.username, 'Anonymous player') as username,
    sr.completed_count,
    sr.player_id = uid as is_current_user,
    sr.total_ranked_players
  from selected_rows sr
  left join public.issued_usernames iu on iu.player_id = sr.player_id
  order by sr.rank_position asc;
end;
$$;

revoke all on function public.get_completion_leaderboard(integer, integer, text)
  from public;
grant execute on function public.get_completion_leaderboard(integer, integer, text)
  to anon, authenticated;

comment on function public.get_completion_leaderboard(integer, integer, text) is
  'Paged leaderboard read model. Supports total_completions, top 15 by default, and includes the caller row even with zero completions.';
