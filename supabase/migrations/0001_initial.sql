-- ============================================================================
-- 0001_initial.sql
-- First migration for Sudoku Squad. Creates the four core tables and a first
-- cut of RLS policies. See docs/ARCHITECTURE.md §4 for the data model.
--
-- IMPORTANT:
--  - puzzles.solution must NEVER be readable by the `anon` or `authenticated`
--    roles. Only service_role (used by Edge Functions and the ingest script)
--    may read it. The RLS policies below enforce this.
--  - All RLS-protected tables have `enable row level security` set.
-- ============================================================================

-- Extensions ------------------------------------------------------------------
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- Tables ---------------------------------------------------------------------

create table if not exists public.puzzles (
  id          uuid primary key default gen_random_uuid(),
  difficulty  text not null check (difficulty in ('easy', 'medium', 'hard', 'expert')),
  givens      smallint[] not null check (array_length(givens, 1) = 81),
  solution    smallint[] not null check (array_length(solution, 1) = 81),
  created_at  timestamptz not null default now()
);

create index if not exists puzzles_difficulty_idx on public.puzzles (difficulty);

comment on column public.puzzles.solution is
  'Server-only. Must never be selectable by anon/authenticated roles.';

create table if not exists public.rooms (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique not null, -- short shareable code
  mode               text not null check (mode in ('single', 'battle', 'coop')),
  puzzle_id          uuid not null references public.puzzles(id),
  status             text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  winner_player_id   uuid,
  settings           jsonb not null default '{}'::jsonb, -- per-room settings (per DECISIONS.md #0009)
  started_at         timestamptz,
  finished_at        timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists rooms_code_idx on public.rooms (code);
create index if not exists rooms_status_idx on public.rooms (status);

create table if not exists public.room_players (
  room_id       uuid not null references public.rooms(id) on delete cascade,
  player_id     uuid not null, -- Supabase anon user id (auth.uid())
  username      text not null check (char_length(username) between 1 and 20),
  color         text not null,
  is_host       boolean not null default false,
  progress_pct  smallint not null default 0 check (progress_pct between 0 and 100),
  joined_at     timestamptz not null default now(),
  primary key (room_id, player_id)
);

create index if not exists room_players_player_idx on public.room_players (player_id);

create table if not exists public.moves (
  id          bigserial primary key,
  room_id     uuid not null references public.rooms(id) on delete cascade,
  player_id   uuid not null,
  seq         bigint not null,
  cell        smallint not null check (cell between 0 and 80),
  kind        text not null check (kind in ('value', 'note_toggle', 'clear')),
  value       smallint check (value between 1 and 9),
  created_at  timestamptz not null default now(),
  unique (room_id, seq)
);

create index if not exists moves_room_idx on public.moves (room_id, seq);

-- RLS ------------------------------------------------------------------------

alter table public.puzzles      enable row level security;
alter table public.rooms        enable row level security;
alter table public.room_players enable row level security;
alter table public.moves        enable row level security;

-- puzzles: clients can read id/difficulty/givens/created_at via a view, but
-- never the solution. We expose a view that omits `solution` and grant select
-- on the view, while keeping the underlying table inaccessible to anon.
create or replace view public.puzzles_public
  with (security_invoker = true)
  as
select id, difficulty, givens, created_at
from public.puzzles;

grant select on public.puzzles_public to anon, authenticated;
-- Note: no policy on public.puzzles means anon/authenticated cannot select it
-- (RLS denies by default once enabled).

-- rooms: anyone with the room id (e.g., from the URL) can read the row.
-- Writes only via service_role (Edge Functions).
create policy "rooms_read_all"
  on public.rooms for select
  to anon, authenticated
  using (true);

-- room_players: a player can read all rows for a room they're in. Insert their
-- own row when joining. No deletes/updates from clients (handled by Edge Functions).
create policy "room_players_read_member"
  on public.room_players for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.room_players rp
      where rp.room_id = room_players.room_id
        and rp.player_id = auth.uid()
    )
    or player_id = auth.uid()
  );

create policy "room_players_insert_self"
  on public.room_players for insert
  to anon, authenticated
  with check (player_id = auth.uid());

-- moves: read all moves in rooms the player is a member of. No client writes;
-- moves are inserted via the submit_move Edge Function (service_role).
create policy "moves_read_member"
  on public.moves for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.room_players rp
      where rp.room_id = moves.room_id
        and rp.player_id = auth.uid()
    )
  );

-- ============================================================================
-- End of 0001_initial.sql
-- ============================================================================
