-- ============================================================================
-- 0003_puzzle_code_and_sp_rpc.sql
--
-- Adds:
--   1. A short, deterministic, URL-friendly `code` to every puzzle (6 chars,
--      lowercase base36). Indexed, unique, NOT NULL.
--   2. An updated `puzzles_public` view that exposes the new column.
--   3. A SECURITY DEFINER RPC `sp_get_puzzle(code)` that returns the full
--      puzzle row — including `solution` — for the single-player code path.
--      Multiplayer (Phase 2+) MUST NOT use this RPC; it will use Edge
--      Functions that track room/player context.
--
-- Hash design:
--   code = base36( first 40 bits of md5(concat(givens)) mod 36^6 ), padded to 6.
--   36^6 ≈ 2.18B. For 1M puzzles, P(collision) ≈ 1M²/(2·36^6) ≈ 0.02%.
--   For our 7500 ingested rows, collision probability is microscopic. The
--   unique constraint catches any future collision; callers (TS ingest) retry.
-- ============================================================================

create extension if not exists "pgcrypto";

-- Pure SQL/PLpgSQL: deterministic, replayable.
create or replace function public.puzzle_code_for(p_givens smallint[]) returns text
  language plpgsql
  immutable
  parallel safe
as $$
declare
  alphabet constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  m        constant bigint := 2176782336; -- 36^6
  n bigint;
  result text := '';
  i int;
begin
  -- First 40 bits of md5(givens-as-text). bit(40)::bigint is always positive.
  n := ('x' || substring(md5(array_to_string(p_givens, '')), 1, 10))::bit(40)::bigint;
  n := n % m;
  for i in 1..6 loop
    result := substring(alphabet, (n % 36)::int + 1, 1) || result;
    n := n / 36;
  end loop;
  return result;
end;
$$;

-- 1. Add column + backfill.
alter table public.puzzles add column code text;
update public.puzzles set code = public.puzzle_code_for(givens);

-- Safety net: if any duplicate slipped through (vanishingly unlikely at
-- 7500 rows), re-hash with a per-row salt until unique.
do $$
declare
  loops int := 0;
  rec record;
  candidate text;
begin
  while loops < 10 loop
    if not exists (
      select 1 from public.puzzles a
      where exists (
        select 1 from public.puzzles b
        where b.code = a.code and b.id <> a.id
      )
    ) then
      exit;
    end if;
    for rec in
      select a.id, a.givens from public.puzzles a
      where exists (
        select 1 from public.puzzles b
        where b.code = a.code and b.id <> a.id
      )
    loop
      -- Append a few random hex chars to the input bytes and re-hash.
      candidate := substring(
        public.puzzle_code_for(
          rec.givens || array[(random()*9)::smallint]::smallint[]
        ),
        1,
        6
      );
      update public.puzzles set code = candidate where id = rec.id;
    end loop;
    loops := loops + 1;
  end loop;
end $$;

alter table public.puzzles alter column code set not null;
alter table public.puzzles add constraint puzzles_code_unique unique (code);
create index puzzles_code_idx on public.puzzles (code);

comment on column public.puzzles.code is
  '6-char lowercase base36 hash of givens. URL-friendly. Deterministic — same puzzle always hashes the same. Unique.';

-- 2. Re-create the public view, now exposing `code`.
drop view if exists public.puzzles_public;
create view public.puzzles_public as
  select id, code, difficulty, givens, created_at
  from public.puzzles;
grant select on public.puzzles_public to anon, authenticated;
comment on view public.puzzles_public is
  'Safe projection of public.puzzles. SECURITY DEFINER by default; anon reads here, never the underlying table. Solution column is intentionally absent.';

-- 3. Single-player RPC. Returns the full row including solution.
-- This is V1-single-player-only. Multiplayer in Phase 2+ uses Edge Functions
-- that track room/player context and never expose the solution to clients.
create or replace function public.sp_get_puzzle(p_code text)
returns table (id uuid, code text, difficulty text, givens smallint[], solution smallint[])
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.code, p.difficulty, p.givens, p.solution
  from public.puzzles p
  where p.code = p_code
  limit 1;
$$;

revoke all on function public.sp_get_puzzle(text) from public;
grant execute on function public.sp_get_puzzle(text) to anon, authenticated;
comment on function public.sp_get_puzzle(text) is
  'Single-player only. Returns full puzzle row including solution. Multiplayer (Phase 2+) MUST NOT use this — see docs/ARCHITECTURE.md §6.';
