-- Promote an active confirmed lobby participant when the current host goes
-- stale. This keeps host authority server-side while letting any active lobby
-- client trigger a safe handoff through the presence heartbeat.

create or replace function public.reassign_inactive_lobby_host(
  p_room_id uuid,
  p_inactive_after timestamptz default now() - interval '30 seconds'
)
returns table (
  changed boolean,
  host_player_id uuid,
  reason text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_status text;
  v_current_host uuid;
  v_current_host_confirmed_at timestamptz;
  v_current_host_seen_at timestamptz;
  v_confirmed_count integer;
  v_next_host uuid;
begin
  perform pg_advisory_xact_lock(hashtext('lobby-host:' || p_room_id::text));

  select r.status
    into v_status
  from public.rooms r
  where r.id = p_room_id
  for update;

  if not found then
    changed := false;
    host_player_id := null;
    reason := 'room_not_found';
    return next;
    return;
  end if;

  if v_status <> 'lobby' then
    select rp.player_id
      into v_current_host
    from public.room_players rp
    where rp.room_id = p_room_id
      and rp.is_host = true
    order by rp.joined_at asc
    limit 1;

    changed := false;
    host_player_id := v_current_host;
    reason := 'not_lobby';
    return next;
    return;
  end if;

  select
    rp.player_id,
    rp.lobby_confirmed_at,
    rp.last_seen_at
    into v_current_host, v_current_host_confirmed_at, v_current_host_seen_at
  from public.room_players rp
  where rp.room_id = p_room_id
    and rp.is_host = true
  order by rp.joined_at asc
  limit 1
  for update;

  select count(*)
    into v_confirmed_count
  from public.room_players rp
  where rp.room_id = p_room_id
    and rp.lobby_confirmed_at is not null;

  if v_current_host is not null
     and v_current_host_confirmed_at is not null
     and v_current_host_seen_at >= p_inactive_after then
    changed := false;
    host_player_id := v_current_host;
    reason := 'host_active';
    return next;
    return;
  end if;

  if v_current_host is not null and v_confirmed_count < 3 then
    changed := false;
    host_player_id := v_current_host;
    reason := 'not_enough_players';
    return next;
    return;
  end if;

  select rp.player_id
    into v_next_host
  from public.room_players rp
  where rp.room_id = p_room_id
    and rp.lobby_confirmed_at is not null
    and rp.last_seen_at >= p_inactive_after
    and (v_current_host is null or rp.player_id <> v_current_host)
  order by rp.joined_at asc
  limit 1
  for update;

  if v_next_host is null then
    changed := false;
    host_player_id := v_current_host;
    reason := 'no_active_successor';
    return next;
    return;
  end if;

  update public.room_players rp
  set is_host = (rp.player_id = v_next_host)
  where rp.room_id = p_room_id;

  changed := true;
  host_player_id := v_next_host;
  reason := case
    when v_current_host is null then 'host_missing'
    else 'host_inactive'
  end;
  return next;
end;
$$;

grant execute on function public.reassign_inactive_lobby_host(uuid, timestamptz) to service_role;

comment on function public.reassign_inactive_lobby_host(uuid, timestamptz) is
  'Promotes the earliest active confirmed non-host when a lobby host is inactive past the caller-provided cutoff.';
