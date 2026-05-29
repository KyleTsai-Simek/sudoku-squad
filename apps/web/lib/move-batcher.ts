/**
 * Per-room opportunistic batching queue for submit-move.
 *
 * Why: every move used to be its own HTTP request. Under fast typing a
 * client would fire 20+ submit-moves serially through the server's
 * rooms.next_seq row lock, taking ~5s wall-clock for all moves to land.
 * Other players saw a slow trickle, and realtime backpressure under bursts
 * could silently drop events.
 *
 * Strategy:
 *   - First move flies immediately (no artificial delay for solo moves).
 *   - While that request is in flight, subsequent moves queue up.
 *   - When the in-flight call returns, any queued moves flush together in
 *     one batched submit-move call.
 *   - The queue chains — moves arriving during the second call queue for
 *     the third, etc. Under steady fast typing the batches grow until they
 *     match the server's drain rate.
 *
 * Per-room scope: each room has its own queue + in-flight flag. Tabs in
 * different rooms don't serialize against each other; tabs in the *same*
 * room (rare) do.
 *
 * The shape of the per-move result is exactly what battle/coop callers
 * expect from `submitMove` so the rest of the store stays the same.
 */

import {
  submitMoves,
  type BatchMoveInput,
  type BatchMoveResult,
  type RoomError,
} from './rooms';

export interface BatchedMoveResult {
  seq: number;
  accepted: true;
  idempotent?: true;
  cell_correct?: boolean;
  progress_pct: number;
  won: boolean;
  is_winner: boolean;
  shared_win?: boolean;
}

type Resolver = (r: { ok: true; value: BatchedMoveResult } | { ok: false; error: RoomError }) => void;

interface Queued {
  move: BatchMoveInput;
  resolve: Resolver;
}

interface RoomQueueState {
  pending: Queued[];
  inFlight: boolean;
}

const queues = new Map<string, RoomQueueState>();

function getQueue(roomId: string): RoomQueueState {
  let q = queues.get(roomId);
  if (!q) {
    q = { pending: [], inFlight: false };
    queues.set(roomId, q);
  }
  return q;
}

/** Hard cap. The server also enforces this; we cap client-side to keep
 *  batches reasonable and predictable. If a player pastes 1000 moves
 *  somehow, we'll send them in 200-move chunks. */
const MAX_BATCH = 200;

/** Transient-failure retry. Every move carries a `client_move_id`, so the
 *  server dedups a retry that actually landed but whose response was lost —
 *  retrying is idempotent and safe. We only retry `internal` errors (5xx /
 *  network), never deterministic rejections (bad_request, forbidden,
 *  invalid_move, room_finished, …) which will fail identically on retry.
 *  After the attempts are exhausted we surface the error and the caller's
 *  store falls back to a full resync. */
const RETRY_BACKOFFS_MS = [250, 600]; // => up to 3 attempts total

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitWithRetry(
  roomId: string,
  moves: BatchMoveInput[],
): Promise<Awaited<ReturnType<typeof submitMoves>>> {
  let last: Awaited<ReturnType<typeof submitMoves>> = {
    ok: false,
    error: { code: 'internal', message: 'no attempt made' },
  };
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await submitMoves({ room_id: roomId, moves });
      if (res.ok) return res;
      last = res;
      // Deterministic failure — retrying won't help.
      if (res.error.code !== 'internal') return res;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      last = { ok: false, error: { code: 'internal', message } };
    }
    if (attempt >= RETRY_BACKOFFS_MS.length) return last;
    await delay(RETRY_BACKOFFS_MS[attempt]!);
  }
}

async function flush(roomId: string): Promise<void> {
  const q = getQueue(roomId);
  if (q.inFlight || q.pending.length === 0) return;
  const batch = q.pending.splice(0, MAX_BATCH);
  q.inFlight = true;
  try {
    const res = await submitWithRetry(roomId, batch.map((b) => b.move));
    if (!res.ok) {
      for (const b of batch) b.resolve({ ok: false, error: res.error });
    } else {
      const v = res.value;
      for (let i = 0; i < batch.length; i++) {
        const r = v.results[i];
        if (!r) {
          batch[i]!.resolve({
            ok: false,
            error: { code: 'internal', message: 'batch result missing for move' },
          });
          continue;
        }
        batch[i]!.resolve({
          ok: true,
          value: {
            ...r,
            progress_pct: v.progress_pct,
            won: v.won,
            is_winner: v.is_winner,
            shared_win: v.shared_win,
          },
        });
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    for (const b of batch) {
      b.resolve({ ok: false, error: { code: 'internal', message } });
    }
  } finally {
    q.inFlight = false;
    // Chain: anything queued during the await above flushes now.
    if (q.pending.length > 0) {
      // Schedule on a microtask so multiple synchronous enqueues in the
      // same tick all batch together.
      void Promise.resolve().then(() => flush(roomId));
    }
  }
}

/**
 * Enqueue a single move. Returns a promise that resolves with the
 * per-move result + aggregate progress/won. Identical to `submitMove`
 * from the caller's perspective.
 */
export function enqueueMove(
  roomId: string,
  move: BatchMoveInput,
): Promise<{ ok: true; value: BatchedMoveResult } | { ok: false; error: RoomError }> {
  return new Promise((resolve) => {
    const q = getQueue(roomId);
    q.pending.push({ move, resolve });
    // Kick a flush. If a flush is already running, it'll chain on
    // completion; otherwise this microtask starts it.
    void Promise.resolve().then(() => flush(roomId));
  });
}

/** For tests / room teardown. Drops queued moves with an error. */
export function clearQueue(roomId: string, reason = 'queue cleared'): void {
  const q = queues.get(roomId);
  if (!q) return;
  for (const b of q.pending) {
    b.resolve({ ok: false, error: { code: 'internal', message: reason } });
  }
  q.pending = [];
}
