-- Migration 0012 — add 'warmup' and 'beginner' tiers to puzzles.difficulty.
--
-- See docs/DECISIONS.md #0033 for background. Two new tiers sitting below
-- 'easy', sourced via QQWing-generated naked-singles-only puzzles augmented
-- with extra clues, given ratings in [-10, 0) by clue count:
--   warmup    rating < -5  (clues 35-40)
--   beginner  rating >= -5 (clues 29-34)

-- Drop the old check constraint and replace it with one that accepts the
-- new tiers. Postgres names the check constraint based on column name; we
-- discover and drop the existing one defensively.
do $$
declare
  cname text;
begin
  select c.conname
    into cname
  from pg_constraint c
  join pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'public'
    and c.contype = 'c'
    and c.conrelid = 'public.puzzles'::regclass
    and pg_get_constraintdef(c.oid) ilike '%difficulty%';
  if cname is not null then
    execute format('alter table public.puzzles drop constraint %I', cname);
  end if;
end $$;

alter table public.puzzles
  add constraint puzzles_difficulty_check
  check (difficulty in ('warmup', 'beginner', 'easy', 'medium', 'hard', 'expert'));

comment on column public.puzzles.difficulty is
  'Difficulty tier. warmup/beginner are easier-than-easy (rating < 0); easy/medium/hard/expert are from the Kaggle 3M rating bands. See DECISIONS #0031, #0032, #0033.';
