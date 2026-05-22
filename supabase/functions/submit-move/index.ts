// Edge Function: submit-move
//
// The server is the authority. Each move:
//   1. Validates input + game state.
//   2. Assigns the next per-room `seq` (the unique constraint catches races).
//   3. Inserts into `moves`.
//   4. Replays this player's moves to materialize their current board.
//   5. Updates room_players.progress_pct (% cells correctly filled).
//   6. If their board now matches the solution, atomically promotes the
//      caller to room.winner_player_id and transitions room.status to
//      'finished'. The `status = 'playing'` guard in the WHERE clause makes
//      sure a second simultaneous "winning move" loses cleanly.
//
// V1 implements battle semantics only (private boards per player). Coop
// (Phase 3) will share the board across players and use LWW-by-seq; that's
// a different submit-move shape.

import '@supabase/functions-js/edge-runtime.d.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { getCallerUserId, serviceClient } from '../_shared/supabase.ts';

const MOVE_KINDS = new Set(['value', 'clear', 'note_toggle']);

interface SubmitMoveInput {
  room_id: string;
  cell: number;
  kind: 'value' | 'clear' | 'note_toggle';
  value?: number | null;
}

function parseInput(body: unknown): SubmitMoveInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.room_id !== 'string') return null;
  if (typeof b.cell !== 'number' || !Number.isInteger(b.cell) || b.cell < 0 || b.cell > 80) return null;
  if (typeof b.kind !== 'string' || !MOVE_KINDS.has(b.kind)) return null;
  const kind = b.kind as SubmitMoveInput['kind'];
  let value: number | null = null;
  if (kind === 'value' || kind === 'note_toggle') {
    if (typeof b.value !== 'number' || !Number.isInteger(b.value) || b.value < 1 || b.value > 9) {
      return null;
    }
    value = b.value;
  }
  return { room_id: b.room_id, cell: b.cell, kind, value };
}

interface MoveRow {
  seq: number;
  cell: number;
  kind: 'value' | 'clear' | 'note_toggle';
  value: number | null;
}

interface PuzzleRow {
  givens: number[];
  solution: number[];
}

/**
 * Materialize the player's board from their move log. Notes don't affect
 * win-detection so we just track value/clear.
 *
 * progressPct = % of non-given cells whose value matches the solution.
 * When pct === 100 the board is complete (because givens are baked into
 * solution at the same positions), so we use that as the win signal.
 */
function materialize(
  givens: number[],
  moves: MoveRow[],
  solution: number[],
): { progressPct: number; won: boolean } {
  const board: Array<number | null> = new Array(81).fill(null);
  for (let i = 0; i < 81; i++) {
    if (givens[i] !== 0) board[i] = givens[i]!;
  }
  for (const m of moves) {
    if (givens[m.cell] !== 0) continue; // belt + suspenders
    if (m.kind === 'value') board[m.cell] = m.value;
    else if (m.kind === 'clear') board[m.cell] = null;
    // note_toggle has no effect on board state
  }
  let correct = 0;
  let total = 0;
  for (let i = 0; i < 81; i++) {
    if (givens[i] !== 0) continue;
    total++;
    if (board[i] === solution[i]) correct++;
  }
  const progressPct = total === 0 ? 100 : Math.round((correct / total) * 100);
  return { progressPct, won: progressPct === 100 };
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') {
    return errorResponse('bad_request', 'POST required', 405);
  }

  const userId = await getCallerUserId(req);
  if (!userId) return errorResponse('unauthenticated', 'missing or invalid JWT', 401);

  let parsed: SubmitMoveInput | null;
  try {
    parsed = parseInput(await req.json());
  } catch {
    return errorResponse('bad_request', 'body is not valid JSON');
  }
  if (!parsed) {
    return errorResponse(
      'bad_request',
      'expected { room_id, cell: 0..80, kind: "value"|"clear"|"note_toggle", value?: 1..9 }',
    );
  }
  const { room_id, cell, kind, value } = parsed;

  const admin = serviceClient();

  // Load room.
  const { data: room, error: roomErr } = await admin
    .from('rooms')
    .select('id, mode, status, puzzle_code')
    .eq('id', room_id)
    .maybeSingle();
  if (roomErr) {
    return errorResponse('internal', `room lookup failed: ${roomErr.message}`, 500);
  }
  if (!room) return errorResponse('not_found', 'room not found', 404);
  if (room.status !== 'playing') {
    return errorResponse('bad_request', `room status is ${room.status}; cannot submit moves`, 409);
  }

  // Caller must be in this room.
  const { data: playerRow, error: playerErr } = await admin
    .from('room_players')
    .select('player_id')
    .eq('room_id', room_id)
    .eq('player_id', userId)
    .maybeSingle();
  if (playerErr) {
    return errorResponse('internal', `room_players lookup failed: ${playerErr.message}`, 500);
  }
  if (!playerRow) return errorResponse('forbidden', 'caller is not in this room', 403);

  // Load puzzle (need givens + solution for validation + win detection).
  const { data: puzzleData, error: puzzleErr } = await admin
    .from('puzzles')
    .select('givens, solution')
    .eq('code', room.puzzle_code)
    .maybeSingle();
  if (puzzleErr || !puzzleData) {
    return errorResponse('internal', `puzzle lookup failed: ${puzzleErr?.message ?? 'no row'}`, 500);
  }
  const p = puzzleData as PuzzleRow;

  // Can't write to a given cell.
  if (p.givens[cell] !== 0) {
    return errorResponse('invalid_move', `cell ${cell} is a given`, 422);
  }

  // Assign next seq with retry on unique(room_id, seq) collision.
  let seq: number | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: maxRow, error: maxErr } = await admin
      .from('moves')
      .select('seq')
      .eq('room_id', room_id)
      .order('seq', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxErr) {
      return errorResponse('internal', `seq lookup failed: ${maxErr.message}`, 500);
    }
    const candidate = (maxRow?.seq ?? 0) + 1;
    const { error: insertErr } = await admin.from('moves').insert({
      room_id,
      player_id: userId,
      seq: candidate,
      cell,
      kind,
      value: kind === 'value' || kind === 'note_toggle' ? value : null,
    });
    if (!insertErr) {
      seq = candidate;
      break;
    }
    if (insertErr.code !== '23505') {
      return errorResponse('internal', `move insert failed: ${insertErr.message}`, 500);
    }
  }
  if (seq === null) {
    return errorResponse('internal', 'could not assign seq after retries', 500);
  }

  // Replay this player's moves to compute current progress + win.
  const { data: ownMoves, error: movesErr } = await admin
    .from('moves')
    .select('seq, cell, kind, value')
    .eq('room_id', room_id)
    .eq('player_id', userId)
    .order('seq', { ascending: true });
  if (movesErr) {
    return errorResponse('internal', `moves read failed: ${movesErr.message}`, 500);
  }
  const { progressPct, won } = materialize(p.givens, (ownMoves ?? []) as MoveRow[], p.solution);

  // Cache progress on the player row so opponents can render their bars.
  const { error: progErr } = await admin
    .from('room_players')
    .update({ progress_pct: progressPct })
    .eq('room_id', room_id)
    .eq('player_id', userId);
  if (progErr) {
    console.error('progress_pct update failed', progErr);
  }

  let isWinner = false;
  if (won && room.mode === 'battle') {
    // Atomic: only become the winner if no one else has already.
    const { data: claimed, error: winErr } = await admin
      .from('rooms')
      .update({
        status: 'finished',
        winner_player_id: userId,
        finished_at: new Date().toISOString(),
      })
      .eq('id', room_id)
      .eq('status', 'playing')
      .select('winner_player_id')
      .maybeSingle();
    if (winErr) {
      return errorResponse('internal', `room finish update failed: ${winErr.message}`, 500);
    }
    isWinner = claimed?.winner_player_id === userId;
  }

  return jsonResponse({
    seq,
    accepted: true,
    progress_pct: progressPct,
    won,
    is_winner: isWinner,
  });
});
