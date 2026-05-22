-- ============================================================================
-- 0011_room_players_has_returned.sql
--
-- Same-room replay cycle per [DECISIONS.md #0030]. Adds a per-player flag
-- that tracks "ready for the next round". Defaults true (matches the initial
-- lobby state). Flipped to false when a game ends; flipped back to true when
-- the player clicks "Return to lobby".
--
-- Existing rows get the default (which is correct — they're "ready").
-- ============================================================================

alter table public.room_players
  add column if not exists has_returned boolean not null default true;

comment on column public.room_players.has_returned is
  'True iff the player is ready for the next round. Set false on game-end, true on return-to-lobby. Host start blocks while any returner is false.';
