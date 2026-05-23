-- ============================================================================
-- 0014_atomic_seq_and_idempotency.sql
--
-- Two related changes to make submit-move both faster and safer under
-- concurrent / retried submissions:
--
--   1. `rooms.next_seq`: per-room atomic counter for assigning move seqs.
--      submit-move now does ONE round-trip
--        update rooms set next_seq = next_seq + 1
--          where id = ? returning next_seq - 1 as seq
--      instead of the read-max-then-insert-with-retry loop. Concurrent
--      submits get distinct seqs without contention on the moves unique
--      index, and no O(retries) blow-up under load.
--
--   2. `moves.client_move_id`: nullable text supplied by the client. Unique
--      per room (partial index excludes NULL). Lets the client safely retry
--      a submit-move HTTP request that may or may not have landed — the
--      duplicate insert is detected and the server returns the already-
--      assigned seq instead of inserting twice. Closes the lost-response
--      duplicate-move hole on flaky mobile networks.
--
-- Backfill: existing rooms in the wild (none in prod V1, but defensive) get
-- next_seq seeded to max(seq)+1 from their existing move log so any in-flight
-- game survives the migration.
-- ============================================================================

alter table public.rooms
  add column if not exists next_seq bigint not null default 1;

comment on column public.rooms.next_seq is
  'Next per-room move seq to assign. submit-move increments atomically with UPDATE ... RETURNING. Reset to 1 on start-game (new round).';

-- Seed next_seq from any existing moves. The "+1" is because next_seq is the
-- NEXT value to assign, and the existing max(seq) is the LAST assigned.
update public.rooms r
   set next_seq = coalesce((
       select max(m.seq) + 1
       from public.moves m
       where m.room_id = r.id
   ), 1)
 where exists (select 1 from public.moves m where m.room_id = r.id);

alter table public.moves
  add column if not exists client_move_id text;

comment on column public.moves.client_move_id is
  'Client-generated idempotency key (uuid-ish text). Unique per (room_id, client_move_id) when non-null. Lets submit-move retries dedupe without inserting twice.';

-- Partial unique index — only enforced when the key is present. Older moves
-- inserted before this migration have NULL and are unaffected.
create unique index if not exists moves_room_client_idem
  on public.moves (room_id, client_move_id)
  where client_move_id is not null;

-- ----------------------------------------------------------------------------
-- reserve_room_seq(p_room_id uuid) -> bigint
--
-- Atomic seq reservation: increments rooms.next_seq and returns the value
-- that was reserved (i.e., the value to stamp on the new moves row). The
-- single UPDATE acquires a row lock so concurrent callers serialize on the
-- room row briefly — no read-then-write race, no unique-constraint retry
-- loop. SECURITY DEFINER so Edge Functions calling via service_role still
-- benefit from a stable signature, and so we can lock down EXECUTE.
--
-- Returns NULL if the room doesn't exist (caller should treat as a 404).
-- ----------------------------------------------------------------------------
create or replace function public.reserve_room_seq(p_room_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  reserved bigint;
begin
  update public.rooms
     set next_seq = next_seq + 1
   where id = p_room_id
  returning next_seq - 1 into reserved;
  return reserved;
end;
$$;

revoke all on function public.reserve_room_seq(uuid) from public;
grant execute on function public.reserve_room_seq(uuid) to service_role;

comment on function public.reserve_room_seq(uuid) is
  'Atomically reserve the next move seq for a room. Returns the reserved value, or NULL if the room does not exist. Service-role only — submit-move is the sole intended caller.';
