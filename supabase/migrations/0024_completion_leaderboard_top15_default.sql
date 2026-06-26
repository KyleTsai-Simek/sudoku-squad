-- ============================================================================
-- 0024_completion_leaderboard_top15_default.sql
--
-- Keep the leaderboard RPC default aligned with the home page: top 15 rows
-- plus the current player's own row when ranked outside that page.
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
  ranked as (
    select
      row_number() over (
        order by
          pt.completed_count desc,
          pt.last_completed_at asc,
          pt.player_id asc
      )::integer as rank_position,
      pt.player_id,
      pt.completed_count,
      count(*) over ()::integer as total_ranked_players
    from player_totals pt
  ),
  page_rows as (
    select *
    from ranked r
    where r.rank_position > page_offset
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
  'Paged leaderboard read model. Currently supports total_completions and includes the caller row when ranked outside the top 15/default requested page.';
