-- ============================================================================
-- 0007_realtime_publications.sql
--
-- Supabase Realtime broadcasts postgres_changes only for tables in the
-- `supabase_realtime` publication. By default it's empty for user tables.
-- The lobby UI subscribes to `room_players` (and Phase 2's gameplay will
-- subscribe to `moves`), so both must be in the publication.
--
-- `rooms` is also published so a lobby can react to status transitions
-- (lobby → playing → finished) without polling.
-- ============================================================================

alter publication supabase_realtime add table public.room_players;
alter publication supabase_realtime add table public.moves;
alter publication supabase_realtime add table public.rooms;
