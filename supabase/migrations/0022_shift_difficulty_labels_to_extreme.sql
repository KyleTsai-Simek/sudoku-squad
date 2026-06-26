-- ============================================================================
-- 0022_shift_difficulty_labels_to_extreme.sql
--
-- Shift visible difficulty labels up one notch:
--   warmup -> easy
--   easy   -> medium
--   medium -> hard
--   hard   -> expert
--   expert -> extreme
--
-- `killer` remains the hidden requires-a-guess tier. Daily puzzles still use
-- easy / medium / hard, which after this migration correspond to the former
-- warmup / easy / medium pools. Existing daily assignments are cleared so the
-- next `get_daily_puzzles()` call reassigns from the new pools.
-- ============================================================================

delete from public.player_daily_completions;
delete from public.daily_puzzles;

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

update public.puzzles set difficulty = 'extreme' where difficulty = 'expert';
update public.puzzles set difficulty = 'expert'  where difficulty = 'hard';
update public.puzzles set difficulty = 'hard'    where difficulty = 'medium';
update public.puzzles set difficulty = 'medium'  where difficulty = 'easy';
update public.puzzles set difficulty = 'easy'    where difficulty = 'warmup';

alter table public.puzzles
  add constraint puzzles_difficulty_check
  check (difficulty in ('easy', 'medium', 'hard', 'expert', 'extreme', 'killer'));

comment on column public.puzzles.difficulty is
  'Difficulty tier after the 2026-06 label shift: easy=former warmup, medium=former easy, hard=former medium, expert=former hard, extreme=former expert. killer remains hidden/requires-a-guess. See DECISIONS #0047.';
