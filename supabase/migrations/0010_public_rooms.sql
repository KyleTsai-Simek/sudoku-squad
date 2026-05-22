-- ============================================================================
-- 0010_public_rooms.sql
--
-- Per [DECISIONS.md #0029], rooms gain an is_public flag. Host toggles in the
-- lobby; default is false. The home page renders a list of currently-open
-- public rooms (status in 'lobby' or 'playing').
--
-- No RLS change needed — anon already has `rooms_read_all`. The new column is
-- just a filter.
-- ============================================================================

alter table public.rooms
  add column if not exists is_public boolean not null default false;

create index if not exists rooms_public_idx
  on public.rooms (is_public, status, created_at desc)
  where is_public = true;

comment on column public.rooms.is_public is
  'Discoverable on the home page list. Toggled by host via update-room-settings.';
