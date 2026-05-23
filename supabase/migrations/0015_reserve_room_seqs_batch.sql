-- ============================================================================
-- 0015_reserve_room_seqs_batch.sql
--
-- Batch counterpart to reserve_room_seq. Reserves N consecutive seqs in one
-- round-trip and returns the BASE seq (caller uses base..base+N-1). The
-- single UPDATE acquires a row lock on the rooms row briefly, the same as
-- the single-seq variant — concurrent batch reservers queue but never
-- collide on the moves unique index.
--
-- Why a separate function instead of just looping reserve_room_seq N times:
-- each call would be a separate round-trip *and* a separate row-lock
-- acquisition. Batching gives N seqs in one atomic step, which is what the
-- new batched submit-move (DECISIONS #0037) needs.
-- ============================================================================

create or replace function public.reserve_room_seqs(p_room_id uuid, p_count int)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  reserved_base bigint;
begin
  if p_count is null or p_count < 1 then
    return null;
  end if;
  update public.rooms
     set next_seq = next_seq + p_count
   where id = p_room_id
  returning next_seq - p_count into reserved_base;
  return reserved_base;
end;
$$;

revoke all on function public.reserve_room_seqs(uuid, int) from public;
grant execute on function public.reserve_room_seqs(uuid, int) to service_role;

comment on function public.reserve_room_seqs(uuid, int) is
  'Atomically reserve p_count consecutive move seqs for a room. Returns the BASE seq (caller uses base..base+p_count-1). Returns NULL if the room does not exist or p_count < 1. Service-role only — submit-move is the sole intended caller.';
