-- Server-owned co-op active-time accounting. Battle remains wall-clock from
-- rooms.started_at; these fields are only read for rooms.mode='coop'.

alter table public.rooms
  add column if not exists coop_active_elapsed_ms integer not null default 0,
  add column if not exists coop_timer_started_at timestamptz,
  add column if not exists coop_timer_paused_at timestamptz;

alter table public.room_players
  add column if not exists game_presence_active boolean not null default false,
  add column if not exists game_presence_updated_at timestamptz;

comment on column public.rooms.coop_active_elapsed_ms is
  'Accumulated co-op active elapsed time in milliseconds, excluding periods where no player is active.';
comment on column public.rooms.coop_timer_started_at is
  'Server timestamp when the current co-op active timer segment started. Null while paused or outside co-op play.';
comment on column public.rooms.coop_timer_paused_at is
  'Server timestamp when the co-op active timer last paused because no players were active.';
comment on column public.room_players.game_presence_active is
  'Best-effort gameplay presence flag used for co-op active-time accounting.';
comment on column public.room_players.game_presence_updated_at is
  'Timestamp of the latest gameplay presence update.';

create or replace function public.update_coop_timer_presence(
  p_room_id uuid,
  p_player_id uuid,
  p_active boolean,
  p_stale_after timestamptz default now() - interval '20 seconds'
)
returns table (
  active_count integer,
  active_elapsed_ms integer,
  timer_started_at timestamptz,
  timer_paused_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_room record;
  v_player_exists boolean;
  v_pre_active_count integer;
  v_active_count integer;
  v_elapsed integer;
  v_timer_started_at timestamptz;
  v_timer_paused_at timestamptz;
  v_pause_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('coop-timer:' || p_room_id::text));

  select
    r.id,
    r.mode,
    r.status,
    r.started_at,
    r.coop_active_elapsed_ms,
    r.coop_timer_started_at,
    r.coop_timer_paused_at
    into v_room
  from public.rooms r
  where r.id = p_room_id
  for update;

  if not found then
    active_count := 0;
    active_elapsed_ms := 0;
    timer_started_at := null;
    timer_paused_at := null;
    return next;
    return;
  end if;

  select exists (
    select 1
    from public.room_players rp
    where rp.room_id = p_room_id
      and rp.player_id = p_player_id
  ) into v_player_exists;

  if not v_player_exists then
    active_count := 0;
    active_elapsed_ms := v_room.coop_active_elapsed_ms;
    timer_started_at := v_room.coop_timer_started_at;
    timer_paused_at := v_room.coop_timer_paused_at;
    return next;
    return;
  end if;

  update public.room_players rp
  set
    game_presence_active = false,
    game_presence_updated_at = coalesce(rp.game_presence_updated_at, v_now)
  where rp.room_id = p_room_id
    and rp.game_presence_active = true
    and rp.game_presence_updated_at < p_stale_after;

  v_elapsed := v_room.coop_active_elapsed_ms;
  v_timer_started_at := v_room.coop_timer_started_at;
  v_timer_paused_at := v_room.coop_timer_paused_at;

  select count(*)
    into v_pre_active_count
  from public.room_players rp
  where rp.room_id = p_room_id
    and rp.game_presence_active = true
    and rp.game_presence_updated_at >= p_stale_after;

  if v_room.mode = 'coop'
     and v_room.status = 'playing'
     and v_pre_active_count = 0
     and v_timer_started_at is not null then
    v_pause_at := greatest(p_stale_after, v_timer_started_at);
    v_elapsed := v_elapsed + greatest(
      0,
      floor(extract(epoch from (v_pause_at - v_timer_started_at)) * 1000)::integer
    );
    v_timer_started_at := null;
    v_timer_paused_at := v_pause_at;

    update public.rooms r
    set
      coop_active_elapsed_ms = v_elapsed,
      coop_timer_started_at = null,
      coop_timer_paused_at = v_pause_at
    where r.id = p_room_id;
  end if;

  update public.room_players rp
  set
    game_presence_active = p_active,
    game_presence_updated_at = v_now,
    last_seen_at = case when p_active then v_now else rp.last_seen_at end,
    lobby_confirmed_at = case
      when p_active then coalesce(rp.lobby_confirmed_at, v_now)
      else rp.lobby_confirmed_at
    end
  where rp.room_id = p_room_id
    and rp.player_id = p_player_id;

  select count(*)
    into v_active_count
  from public.room_players rp
  where rp.room_id = p_room_id
    and rp.game_presence_active = true
    and rp.game_presence_updated_at >= p_stale_after;

  if v_room.mode = 'coop' and v_room.status = 'playing' then
    if v_active_count > 0 and v_timer_started_at is null then
      v_timer_started_at := greatest(v_now, v_room.started_at + interval '5 seconds');
      v_timer_paused_at := null;

      update public.rooms r
      set
        coop_timer_started_at = v_timer_started_at,
        coop_timer_paused_at = null
      where r.id = p_room_id;
    elsif v_active_count = 0 and v_timer_started_at is not null then
      v_elapsed := v_elapsed + greatest(
        0,
        floor(extract(epoch from (v_now - v_timer_started_at)) * 1000)::integer
      );
      v_timer_started_at := null;
      v_timer_paused_at := v_now;

      update public.rooms r
      set
        coop_active_elapsed_ms = v_elapsed,
        coop_timer_started_at = null,
        coop_timer_paused_at = v_now
      where r.id = p_room_id;
    end if;
  end if;

  active_count := v_active_count;
  active_elapsed_ms := v_elapsed + case
    when v_timer_started_at is not null then greatest(
      0,
      floor(extract(epoch from (v_now - v_timer_started_at)) * 1000)::integer
    )
    else 0
  end;
  timer_started_at := v_timer_started_at;
  timer_paused_at := v_timer_paused_at;
  return next;
end;
$$;

grant execute on function public.update_coop_timer_presence(uuid, uuid, boolean, timestamptz) to service_role;

comment on function public.update_coop_timer_presence(uuid, uuid, boolean, timestamptz) is
  'Updates a player gameplay presence flag and atomically advances or pauses co-op active elapsed time.';

create or replace function public.finish_coop_timer(
  p_room_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_elapsed integer;
  v_started_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('coop-timer:' || p_room_id::text));

  select r.coop_active_elapsed_ms, r.coop_timer_started_at
    into v_elapsed, v_started_at
  from public.rooms r
  where r.id = p_room_id
  for update;

  if not found then
    return 0;
  end if;

  if v_started_at is not null then
    v_elapsed := v_elapsed + greatest(
      0,
      floor(extract(epoch from (v_now - v_started_at)) * 1000)::integer
    );
  end if;

  update public.rooms r
  set
    coop_active_elapsed_ms = v_elapsed,
    coop_timer_started_at = null,
    coop_timer_paused_at = null
  where r.id = p_room_id;

  update public.room_players rp
  set game_presence_active = false
  where rp.room_id = p_room_id;

  return v_elapsed;
end;
$$;

grant execute on function public.finish_coop_timer(uuid) to service_role;

comment on function public.finish_coop_timer(uuid) is
  'Finalizes co-op active elapsed time when a shared board is completed.';
