-- Migration 0017 — retire the Kaggle-sourced puzzle bank for the upper tiers.
--
-- The medium/hard/expert/killer tiers move from the Kaggle 3M dataset to local
-- QQWing generation, graded by QQWing's difficulty class + technique counts
-- (see docs/DECISIONS.md #0042). This migration removes the old Kaggle rows so
-- the QQWing-graded ingest can repopulate all four upper tiers from scratch.
--
-- The `killer` tier is RETAINED (it's revived as the pure-EXPERT / requires-a-
-- guess tier), so the difficulty check constraint is unchanged. warmup + easy
-- (QQWing-sourced, negative-rated) are untouched.
--
-- DESTRUCTIVE. The FKs into puzzles (rooms.puzzle_code, player_completions.
-- puzzle_code) are ON UPDATE CASCADE but NOT ON DELETE CASCADE, so we clear
-- dependents first, in dependency order. Deleting a room cascades to its
-- room_players + moves via their ON DELETE CASCADE on room_id.
--
-- Run AFTER 0016 (the metadata columns) and BEFORE the QQWing-graded ingest:
--   supabase db push --linked
--   pnpm --filter @sudoku-squad/ingest ingest:qqwing-graded

begin;

-- Codes of every row we're about to remove (the four upper, Kaggle-sourced tiers).
create temporary table _doomed_codes on commit drop as
  select code from public.puzzles
  where difficulty in ('medium', 'hard', 'expert', 'killer');

-- 1. completions referencing those puzzles.
delete from public.player_completions
  where puzzle_code in (select code from _doomed_codes);

-- 2. rooms referencing those puzzles (cascades to room_players + moves).
delete from public.rooms
  where puzzle_code in (select code from _doomed_codes);

-- 3. the puzzles themselves.
delete from public.puzzles
  where difficulty in ('medium', 'hard', 'expert', 'killer');

comment on column public.puzzles.difficulty is
  'Difficulty tier. All tiers are now QQWing-generated: warmup/easy by clue count (rating < 0, see #0033); medium/hard/expert/killer by QQWing difficulty class + technique counts (EASY / INTERMEDIATE-1tech / INTERMEDIATE-2+tech / EXPERT-requires-guess, see #0042). killer stays hidden from the picker.';

commit;
