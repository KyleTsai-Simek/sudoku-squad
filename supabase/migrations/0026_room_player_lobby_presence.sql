-- 0026_room_player_lobby_presence.sql
-- Separate durable room membership from "confirmed visible in lobby" presence.
-- This prevents transient mobile in-app browser joins from showing up as real
-- players before the user settles in the room.

alter table public.room_players
  add column if not exists lobby_confirmed_at timestamptz,
  add column if not exists last_seen_at timestamptz;

update public.room_players
set
  lobby_confirmed_at = coalesce(lobby_confirmed_at, joined_at),
  last_seen_at = coalesce(last_seen_at, joined_at)
where lobby_confirmed_at is null
   or last_seen_at is null;

create index if not exists room_players_lobby_presence_idx
  on public.room_players (room_id, lobby_confirmed_at, last_seen_at);

comment on column public.room_players.lobby_confirmed_at is
  'Set after the client remains in the room long enough to count as a visible participant. NULL rows are durable seats but hidden from other lobby users and do not count for Start.';

comment on column public.room_players.last_seen_at is
  'Best-effort heartbeat timestamp for confirmed room participants. Used for future disconnect grace and stale-row cleanup.';
