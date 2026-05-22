-- ============================================================================
-- 0006_fix_room_players_rls_recursion.sql
--
-- The `room_players_read_member` policy in migration 0001 used an EXISTS
-- subquery against `room_players` itself to check membership. Postgres
-- re-evaluates the SELECT policy for the inner row, which recurses, which
-- Postgres detects and aborts with:
--
--   42P17 — infinite recursion detected in policy for relation "room_players"
--
-- The standard fix is to do the membership check in a SECURITY DEFINER
-- function. The function runs as its owner (postgres), which bypasses RLS,
-- so the inner SELECT doesn't recurse.
-- ============================================================================

create or replace function public.is_room_member(p_room uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.room_players
    where room_id = p_room
      and player_id = auth.uid()
  );
$$;

revoke all on function public.is_room_member(uuid) from public;
grant execute on function public.is_room_member(uuid) to anon, authenticated, service_role;

drop policy if exists "room_players_read_member" on public.room_players;
create policy "room_players_read_member"
  on public.room_players for select
  to anon, authenticated
  using (
    -- Own row is always visible (covers the join echo) ...
    player_id = auth.uid()
    -- ... plus any row in a room I'm currently in.
    or public.is_room_member(room_players.room_id)
  );

-- moves had the same shape — it queries room_players to check membership,
-- which is now safe via the helper but worth re-stating for clarity.
drop policy if exists "moves_read_member" on public.moves;
create policy "moves_read_member"
  on public.moves for select
  to anon, authenticated
  using (public.is_room_member(moves.room_id));

comment on function public.is_room_member(uuid) is
  'SECURITY DEFINER membership check used by room_players/moves RLS to avoid self-referencing recursion.';
