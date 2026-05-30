-- Migration 0016 — add QQWing solving-metadata columns to puzzles.
--
-- The medium/hard/expert tiers are being regenerated locally via QQWing and
-- graded by QQWing's own difficulty classification + technique counts rather
-- than the retired Kaggle rating bands. We store that per-puzzle metadata so a
-- tier is defined by the logic it forces, and so we can re-band later without
-- regenerating. See docs/DECISIONS.md #0042.
--
-- All columns are nullable: the existing warmup/easy rows (and any legacy rows)
-- predate this and simply carry NULLs. The QQWing-graded ingest populates them.

alter table public.puzzles
  add column if not exists qqwing_difficulty          text,      -- 'easy' | 'intermediate' | 'expert'
  add column if not exists clue_count                 smallint,
  add column if not exists guess_count                smallint,
  add column if not exists backtrack_count            smallint,
  add column if not exists single_count               smallint,
  add column if not exists hidden_single_count        smallint,
  add column if not exists naked_pair_count           smallint,
  add column if not exists hidden_pair_count          smallint,
  add column if not exists pointing_pair_triple_count smallint,
  add column if not exists box_line_reduction_count   smallint,
  add column if not exists advanced_technique_count   smallint; -- distinct advanced techniques used (0-4)

comment on column public.puzzles.qqwing_difficulty is
  'QQWing''s own solve-difficulty label for this puzzle (easy/intermediate/expert). The source of truth for the medium/hard/expert tier mapping. NULL for warmup/easy and legacy rows.';
comment on column public.puzzles.guess_count is
  'Number of guesses QQWing''s solver needed. 0 means the puzzle is solvable by pure logic. The hidden killer tier is exactly the guess_count >= 1 puzzles (QQWing EXPERT).';
comment on column public.puzzles.advanced_technique_count is
  'Distinct advanced techniques the solve required, of {naked pair, hidden pair, pointing pair/triple, box-line reduction}. Splits pure-logic INTERMEDIATE into hard (1) vs expert (>=2). See DECISIONS #0042.';
