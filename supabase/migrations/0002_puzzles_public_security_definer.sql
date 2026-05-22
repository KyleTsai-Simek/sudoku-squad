-- ============================================================================
-- 0002_puzzles_public_security_definer.sql
--
-- Fix the `puzzles_public` view so anon can actually read it.
--
-- 0001 created the view with `with (security_invoker = true)`, which makes
-- the view run with the *caller's* RLS context. The caller is `anon`, which
-- has no select policy on `public.puzzles` — so the view returns 0 rows
-- even when the underlying table has data. This was masked while the table
-- was empty; the ingest landed 7500 rows and the bug became visible.
--
-- The view's whole job is to project a safe subset of `puzzles` (everything
-- except `solution`) to clients. That's exactly what a SECURITY DEFINER view
-- is for: anon can read every row of `puzzles_public`, and `solution` is
-- never visible because the column isn't in the view. RLS on the underlying
-- table still denies anon any direct access.
-- ============================================================================

drop view if exists public.puzzles_public;

create view public.puzzles_public as
  select id, difficulty, givens, created_at
  from public.puzzles;

grant select on public.puzzles_public to anon, authenticated;

comment on view public.puzzles_public is
  'Safe projection of public.puzzles. SECURITY DEFINER by default; anon reads here, never the underlying table. Solution column is intentionally absent.';
