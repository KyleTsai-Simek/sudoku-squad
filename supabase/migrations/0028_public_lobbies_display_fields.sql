-- Add home-page display fields to the public lobby browse read model.
-- The client still sees only public, lobby-status rooms with recent confirmed
-- presence; host usernames are room-scoped display names, not account data.

drop function if exists public.get_public_lobbies(timestamptz, integer);

create function public.get_public_lobbies(
  p_recent_after timestamptz default now() - interval '30 seconds',
  p_limit integer default 20
)
returns table (
  id uuid,
  code text,
  mode text,
  status text,
  difficulty text,
  host_username text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.code,
    r.mode,
    r.status,
    p.difficulty,
    coalesce(host_player.username, 'Host') as host_username,
    r.created_at
  from public.rooms r
  join public.puzzles p on p.code = r.puzzle_code
  left join lateral (
    select rp.username
    from public.room_players rp
    where rp.room_id = r.id
      and rp.is_host = true
    order by rp.joined_at asc
    limit 1
  ) host_player on true
  where r.is_public = true
    and r.status = 'lobby'
    and exists (
      select 1
      from public.room_players rp
      where rp.room_id = r.id
        and rp.lobby_confirmed_at is not null
        and rp.last_seen_at >= p_recent_after
    )
  order by r.created_at desc
  limit greatest(0, least(coalesce(p_limit, 20), 100));
$$;

grant execute on function public.get_public_lobbies(timestamptz, integer) to anon, authenticated;

comment on function public.get_public_lobbies(timestamptz, integer) is
  'Public home-page lobby browse: public lobby-status rooms with recent confirmed presence, puzzle difficulty, and host display name.';
