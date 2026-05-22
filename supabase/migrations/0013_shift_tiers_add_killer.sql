-- Migration 0013 — shift tier labels up one, hide former-expert as 'killer'.
--
-- Old labels (after migration 0012):  warmup, beginner, easy, medium, hard, expert
-- New labels:                          warmup,           easy, medium, hard, expert, killer
--
-- The home-page tier picker hides 'killer' (it stays in the DB as inventory
-- for a future "evil" mode). See DECISIONS.md #0034.

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

-- Rename in reverse order so each step's source doesn't collide with a
-- later step's destination. e.g. if we mapped easy→medium before
-- medium→hard, the rows that came from "easy" would be wrongly relabeled
-- twice. Going top-down avoids that.
update public.puzzles set difficulty = 'killer' where difficulty = 'expert';
update public.puzzles set difficulty = 'expert' where difficulty = 'hard';
update public.puzzles set difficulty = 'hard'   where difficulty = 'medium';
update public.puzzles set difficulty = 'medium' where difficulty = 'easy';
update public.puzzles set difficulty = 'easy'   where difficulty = 'beginner';

alter table public.puzzles
  add constraint puzzles_difficulty_check
  check (difficulty in ('warmup', 'easy', 'medium', 'hard', 'expert', 'killer'));

comment on column public.puzzles.difficulty is
  'Difficulty tier. warmup is easier-than-easy (QQWing-generated, rating < -5). easy is rating [-5, 0) (QQWing). medium/hard/expert/killer come from the Kaggle 3M source. killer is intentionally not exposed in the UI yet. See DECISIONS #0033, #0034.';
