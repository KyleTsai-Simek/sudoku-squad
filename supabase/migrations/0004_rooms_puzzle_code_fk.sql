-- ============================================================================
-- 0004_rooms_puzzle_code_fk.sql
--
-- Two related cleanups, ahead of Phase 2 (battle/coop):
--
-- 1. `rooms` referenced puzzles by the internal UUID `puzzle_id`. We've since
--    settled on `puzzles.code` as the cross-mode puzzle identifier — it's
--    what URLs use (`/play/[code]`), what the in-repo sample pack pins, and
--    what we'll embed in admin queries. Drop `puzzle_id`, add `puzzle_code`
--    referencing `puzzles(code)`.
--
-- 2. `rooms.mode` originally accepted `single` / `battle` / `coop`. But
--    single-player doesn't actually create rooms (it just navigates to
--    `/play/[code]` and uses localStorage for state). Drop `single` from the
--    CHECK so the schema reflects what we actually build.
--
-- The `rooms` table is empty in production (no multiplayer yet) so neither
-- change touches user data. If you re-run this against a non-empty rooms
-- table, the column drop will fail loudly — that's intentional.
--
-- See docs/DECISIONS.md #0020 (puzzle code as cross-mode FK) and
-- #0022 (drop 'single' from rooms.mode).
-- ============================================================================

-- 1. Swap puzzle_id (uuid → puzzles.id) for puzzle_code (text → puzzles.code).
alter table public.rooms drop column puzzle_id;

alter table public.rooms add column puzzle_code text not null
  references public.puzzles(code) on update cascade;

comment on column public.rooms.puzzle_code is
  'The puzzle this room is playing. Joins to puzzles.code (unique). Same identifier as the URL slug.';

-- 2. Reduce rooms.mode to the two values we actually build.
alter table public.rooms drop constraint if exists rooms_mode_check;
alter table public.rooms add constraint rooms_mode_check
  check (mode in ('battle', 'coop'));
