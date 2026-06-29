-- Public lobby browse should show only joinable, currently attended lobby rooms.
-- Room rows stay durable for deep links/rejoin, but the home page list should
-- age out empty rooms and hide games once they have started.

create or replace function public.get_public_lobbies(
  p_recent_after timestamptz default now() - interval '30 seconds',
  p_limit integer default 20
)
returns table (
  id uuid,
  code text,
  mode text,
  status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.code, r.mode, r.status, r.created_at
  from public.rooms r
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
  'Public home-page lobby browse: public lobby-status rooms with at least one recently seen confirmed participant.';
