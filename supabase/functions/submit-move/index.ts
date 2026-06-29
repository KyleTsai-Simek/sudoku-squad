// Edge Function: submit-move
//
// Server is the authority. Accepts EITHER a single move (legacy shape) OR a
// batch of moves in one request (preferred — see DECISIONS #0037). For each
// call:
//
//   1. Validate input + game state.
//   2. Identify already-accepted client_move_ids for idempotent dedup.
//   3. Reserve N consecutive seqs atomically (rooms.next_seq via
//      reserve_room_seqs RPC). One round-trip regardless of batch size.
//   4. Insert all moves in a single batch insert.
//   5. Replay this player's moves (battle) or every move (coop) once to
//      materialize the final board.
//   6. Update room_players.progress_pct.
//   7. If the board now matches the solution, atomically transition the
//      room to 'finished' (the same `where status='playing'` guard handles
//      simultaneous winners cleanly).
//
// Batch shape:
//   Request:  { room_id, moves: [{cell, kind, value?, client_move_id?}, ...] }
//   Response: { results: [{seq, accepted, cell_correct?, idempotent?}, ...],
//               progress_pct, won, is_winner }
//
// Single shape (backward-compatible):
//   Request:  { room_id, cell, kind, value?, client_move_id? }
//   Response: { seq, accepted, progress_pct, won, is_winner, cell_correct?, idempotent? }

import '@supabase/functions-js/edge-runtime.d.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { normalizeSettings } from '../_shared/settings.ts';
import { getCallerUserId, serviceClient } from '../_shared/supabase.ts';

const MOVE_KINDS = new Set(['value', 'clear', 'note_toggle']);
const MAX_BATCH = 200; // Hard cap; keeps a single call bounded and reasonable.

interface MoveInput {
  cell: number;
  kind: 'value' | 'clear' | 'note_toggle';
  value: number | null;
  client_move_id: string | null;
}

interface SubmitInput {
  room_id: string;
  moves: MoveInput[];
  /** Whether the caller used the legacy single-move shape (so we return the
   *  flat single-move response on the way out). */
  isLegacy: boolean;
}

function parseMove(raw: unknown): MoveInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.cell !== 'number' || !Number.isInteger(b.cell) || b.cell < 0 || b.cell > 80) return null;
  if (typeof b.kind !== 'string' || !MOVE_KINDS.has(b.kind)) return null;
  const kind = b.kind as MoveInput['kind'];
  let value: number | null = null;
  if (kind === 'value' || kind === 'note_toggle') {
    if (typeof b.value !== 'number' || !Number.isInteger(b.value) || b.value < 1 || b.value > 9) {
      return null;
    }
    value = b.value;
  }
  let client_move_id: string | null = null;
  if (typeof b.client_move_id === 'string' && b.client_move_id.length > 0 && b.client_move_id.length <= 64) {
    client_move_id = b.client_move_id;
  }
  return { cell: b.cell, kind, value, client_move_id };
}

function parseInput(body: unknown): SubmitInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.room_id !== 'string') return null;
  if (Array.isArray(b.moves)) {
    const moves: MoveInput[] = [];
    for (const raw of b.moves) {
      const m = parseMove(raw);
      if (!m) return null;
      moves.push(m);
    }
    if (moves.length === 0) return null;
    if (moves.length > MAX_BATCH) return null;
    return { room_id: b.room_id, moves, isLegacy: false };
  }
  // Legacy single-move shape.
  const single = parseMove(b);
  if (!single) return null;
  return { room_id: b.room_id, moves: [single], isLegacy: true };
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
 * Materialize a board from givens + a seq-ordered move log. Notes don't
 * affect win-detection so we only need value/clear.
 */
function materialize(
  givens: number[],
  moves: MoveRow[],
  solution: number[],
): { progressPct: number; won: boolean } {
  const board: Array<number | null> = new Array(81).fill(null);
  for (let i = 0; i < 81; i++) if (givens[i] !== 0) board[i] = givens[i]!;
  for (const m of moves) {
    if (givens[m.cell] !== 0) continue;
    if (m.kind === 'value') board[m.cell] = m.value;
    else if (m.kind === 'clear') board[m.cell] = null;
  }
  let filled = 0;
  let correct = 0;
  let total = 0;
  for (let i = 0; i < 81; i++) {
    if (givens[i] !== 0) continue;
    total++;
    if (board[i] !== null) filled++;
    if (board[i] === solution[i]) correct++;
  }
  const progressPct = total === 0 ? 100 : Math.round((filled / total) * 100);
  const won = correct === total;
  return { progressPct, won };
}

interface PerMoveResult {
  seq: number;
  accepted: true;
  idempotent?: true;
  cell_correct?: boolean;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') {
    return errorResponse('bad_request', 'POST required', 405);
  }

  const userId = await getCallerUserId(req);
  if (!userId) return errorResponse('unauthenticated', 'missing or invalid JWT', 401);

  let parsed: SubmitInput | null;
  try {
    parsed = parseInput(await req.json());
  } catch {
    return errorResponse('bad_request', 'body is not valid JSON');
  }
  if (!parsed) {
    return errorResponse(
      'bad_request',
      `expected { room_id, moves: [...] } or { room_id, cell, kind, value?, client_move_id? }. Batch capped at ${MAX_BATCH}.`,
    );
  }
  const { room_id, moves, isLegacy } = parsed;

  const admin = serviceClient();

  // Step 1: room read.
  const { data: room, error: roomErr } = await admin
    .from('rooms')
    .select('id, mode, status, puzzle_code, settings')
    .eq('id', room_id)
    .maybeSingle();
  if (roomErr) {
    return errorResponse('internal', `room lookup failed: ${roomErr.message}`, 500);
  }
  if (!room) return errorResponse('not_found', 'room not found', 404);
  if (room.status === 'lobby') {
    return errorResponse('bad_request', 'game has not started', 409);
  }

  // Step 2: parallel reads — player check, puzzle, and idempotency dups
  // for any client_move_ids provided in the batch.
  const cids = moves
    .map((m) => m.client_move_id)
    .filter((v): v is string => v !== null);
  const [playerRes, puzzleRes, dupRes] = await Promise.all([
    admin
      .from('room_players')
      .select('player_id, lobby_confirmed_at')
      .eq('room_id', room_id)
      .eq('player_id', userId)
      .maybeSingle(),
    admin
      .from('puzzles')
      .select('givens, solution')
      .eq('code', room.puzzle_code)
      .maybeSingle(),
    cids.length > 0
      ? admin
          .from('moves')
          .select('seq, client_move_id')
          .eq('room_id', room_id)
          .in('client_move_id', cids)
      : Promise.resolve({ data: [] as Array<{ seq: number; client_move_id: string }>, error: null }),
  ]);

  if (playerRes.error) {
    return errorResponse('internal', `room_players lookup failed: ${playerRes.error.message}`, 500);
  }
  if (!playerRes.data) return errorResponse('forbidden', 'caller is not in this room', 403);
  if (puzzleRes.error || !puzzleRes.data) {
    return errorResponse(
      'internal',
      `puzzle lookup failed: ${puzzleRes.error?.message ?? 'no row'}`,
      500,
    );
  }
  const p = puzzleRes.data as PuzzleRow;

  // Validate: no writes to given cells.
  for (const m of moves) {
    if (p.givens[m.cell] !== 0) {
      return errorResponse('invalid_move', `cell ${m.cell} is a given`, 422);
    }
  }

  // Identify which moves are already-accepted dups (skip insert, return
  // the prior seq).
  const dupRows = (dupRes.data ?? []) as Array<{ seq: number; client_move_id: string }>;
  const dupByCid = new Map<string, number>();
  for (const r of dupRows) dupByCid.set(r.client_move_id, r.seq);

  // Partition: fresh moves to insert vs. dupes to skip.
  const fresh: Array<{ index: number; move: MoveInput }> = [];
  const results: PerMoveResult[] = new Array(moves.length);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i]!;
    if (m.client_move_id && dupByCid.has(m.client_move_id)) {
      const seq = dupByCid.get(m.client_move_id)!;
      results[i] = { seq, accepted: true, idempotent: true };
    } else {
      fresh.push({ index: i, move: m });
    }
  }

  // Step 3: reserve N seqs atomically if we have any fresh moves.
  if (fresh.length > 0) {
    const { data: baseSeqRaw, error: seqErr } = await admin.rpc('reserve_room_seqs', {
      p_room_id: room_id,
      p_count: fresh.length,
    });
    if (seqErr || baseSeqRaw === null || baseSeqRaw === undefined) {
      return errorResponse('internal', `seq reserve failed: ${seqErr?.message ?? 'no row'}`, 500);
    }
    const baseSeq = Number(baseSeqRaw);

    // Step 4: insert all fresh moves in one batch.
    const insertRows = fresh.map(({ move }, k) => ({
      room_id,
      player_id: userId,
      seq: baseSeq + k,
      cell: move.cell,
      kind: move.kind,
      value: move.kind === 'value' || move.kind === 'note_toggle' ? move.value : null,
      client_move_id: move.client_move_id ?? null,
    }));

    const { error: insertErr } = await admin.from('moves').insert(insertRows);
    if (insertErr) {
      // 23505 here means a race on (room_id, client_move_id) — another
      // submit-move call landed the same cid between our dup check and our
      // insert. Re-fetch the resolved cids and treat those rows as idempotent.
      if (insertErr.code === '23505') {
        const racedCids = fresh
          .map(({ move }) => move.client_move_id)
          .filter((v): v is string => v !== null);
        if (racedCids.length > 0) {
          const { data: priorRows } = await admin
            .from('moves')
            .select('seq, client_move_id')
            .eq('room_id', room_id)
            .in('client_move_id', racedCids);
          const priorByCid = new Map<string, number>();
          for (const r of priorRows ?? []) {
            priorByCid.set((r as { client_move_id: string }).client_move_id, (r as { seq: number }).seq);
          }
          // Re-attempt insert for only the truly fresh ones.
          const remainingFresh = fresh.filter(
            ({ move }) => !move.client_move_id || !priorByCid.has(move.client_move_id),
          );
          for (const { index, move } of fresh) {
            if (move.client_move_id && priorByCid.has(move.client_move_id)) {
              results[index] = { seq: priorByCid.get(move.client_move_id)!, accepted: true, idempotent: true };
            }
          }
          if (remainingFresh.length > 0) {
            // Reserve more seqs (the original reservation has gaps; that's OK).
            const { data: base2Raw, error: seq2Err } = await admin.rpc('reserve_room_seqs', {
              p_room_id: room_id,
              p_count: remainingFresh.length,
            });
            if (seq2Err || base2Raw === null) {
              return errorResponse('internal', `seq re-reserve failed: ${seq2Err?.message ?? 'no row'}`, 500);
            }
            const base2 = Number(base2Raw);
            const rows2 = remainingFresh.map(({ move }, k) => ({
              room_id,
              player_id: userId,
              seq: base2 + k,
              cell: move.cell,
              kind: move.kind,
              value: move.kind === 'value' || move.kind === 'note_toggle' ? move.value : null,
              client_move_id: move.client_move_id ?? null,
            }));
            const { error: i2 } = await admin.from('moves').insert(rows2);
            if (i2) {
              return errorResponse('internal', `move re-insert failed: ${i2.message}`, 500);
            }
            for (let k = 0; k < remainingFresh.length; k++) {
              results[remainingFresh[k]!.index] = { seq: base2 + k, accepted: true };
            }
          }
        } else {
          return errorResponse('internal', `move insert failed: ${insertErr.message}`, 500);
        }
      } else {
        return errorResponse('internal', `move insert failed: ${insertErr.message}`, 500);
      }
    } else {
      // Happy path: all fresh inserts landed.
      for (let k = 0; k < fresh.length; k++) {
        results[fresh[k]!.index] = { seq: baseSeq + k, accepted: true };
      }
    }
  }

  // Step 5: materialize once. Battle uses the caller's own moves; coop
  // uses every move in the room.
  const movesQuery = admin
    .from('moves')
    .select('seq, cell, kind, value')
    .eq('room_id', room_id)
    .order('seq', { ascending: true });
  if (room.mode === 'battle') movesQuery.eq('player_id', userId);
  const { data: replayMoves, error: movesErr } = await movesQuery;
  if (movesErr) {
    return errorResponse('internal', `moves read failed: ${movesErr.message}`, 500);
  }
  const { progressPct, won } = materialize(p.givens, (replayMoves ?? []) as MoveRow[], p.solution);

  const seenAt = new Date().toISOString();
  const presencePromise =
    room.mode === 'coop'
      ? admin
          .rpc('update_coop_timer_presence', {
            p_room_id: room_id,
            p_player_id: userId,
            p_active: true,
          })
          .then(({ error }) => {
            if (error) console.error('coop timer presence update failed', error);
          })
      : admin
          .from('room_players')
          .update({
            lobby_confirmed_at: playerRes.data.lobby_confirmed_at ?? seenAt,
            last_seen_at: seenAt,
          })
          .eq('room_id', room_id)
          .eq('player_id', userId)
          .then(({ error }) => {
            if (error) console.error('room presence update failed', error);
          });

  // Step 6: cache progress.
  const progressUpdate = admin
    .from('room_players')
    .update({ progress_pct: progressPct })
    .eq('room_id', room_id);
  if (room.mode === 'battle') progressUpdate.eq('player_id', userId);
  const progressPromise = progressUpdate.then(({ error }) => {
    if (error) console.error('progress_pct update failed', error);
  });

  // Step 7: win logic.
  let isWinner = false;
  let isSharedWin = false;
  if (won && room.mode === 'battle') {
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
      await Promise.all([progressPromise, presencePromise]);
      return errorResponse('internal', `room finish update failed: ${winErr.message}`, 500);
    }
    isWinner = claimed?.winner_player_id === userId;
    if (isWinner) {
      const { error: hrErr } = await admin
        .from('room_players')
        .update({ has_returned: false })
        .eq('room_id', room_id);
      if (hrErr) console.error('has_returned reset failed', hrErr);
    }
  } else if (won && room.mode === 'coop') {
    const { data: claimed, error: winErr } = await admin
      .from('rooms')
      .update({
        status: 'finished',
        winner_player_id: null,
        finished_at: new Date().toISOString(),
      })
      .eq('id', room_id)
      .eq('status', 'playing')
      .select('id')
      .maybeSingle();
    if (winErr) {
      await Promise.all([progressPromise, presencePromise]);
      return errorResponse('internal', `room finish update failed: ${winErr.message}`, 500);
    }
    isSharedWin = !!claimed;
    if (isSharedWin) {
      const { error: timerErr } = await admin.rpc('finish_coop_timer', {
        p_room_id: room_id,
      });
      if (timerErr) console.error('coop timer finish failed', timerErr);
      const { error: hrErr } = await admin
        .from('room_players')
        .update({ has_returned: false })
        .eq('room_id', room_id);
      if (hrErr) console.error('has_returned reset failed', hrErr);
      const { data: members } = await admin
        .from('room_players')
        .select('player_id')
        .eq('room_id', room_id);
      if (members && members.length > 0) {
        const rows = members.map((m) => ({
          player_id: (m as { player_id: string }).player_id,
          puzzle_code: room.puzzle_code,
          mode: room.mode,
        }));
        const { error: cErr } = await admin
          .from('player_completions')
          .upsert(rows, { onConflict: 'player_id,puzzle_code' });
        if (cErr) console.error('coop player_completions upsert failed', cErr);
      }
    }
  }
  if (won && room.mode === 'battle') {
    const { error: cErr } = await admin.from('player_completions').upsert(
      { player_id: userId, puzzle_code: room.puzzle_code, mode: room.mode },
      { onConflict: 'player_id,puzzle_code' },
    );
    if (cErr) console.error('player_completions upsert failed', cErr);
  }

  await Promise.all([progressPromise, presencePromise]);

  // Per-move autocheck — fill cell_correct on value moves when autoCheck is on.
  const settings = normalizeSettings(room.settings);
  if (settings.autoCheck) {
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i]!;
      if (m.kind === 'value' && m.value !== null) {
        results[i]!.cell_correct = m.value === p.solution[m.cell];
      }
    }
  }

  // Shape the response. Legacy single-move callers get the flat shape;
  // batch callers get the array shape.
  if (isLegacy) {
    const r0 = results[0]!;
    return jsonResponse({
      seq: r0.seq,
      accepted: r0.accepted,
      progress_pct: progressPct,
      won,
      is_winner: isWinner,
      ...(r0.idempotent ? { idempotent: true } : {}),
      ...(r0.cell_correct !== undefined ? { cell_correct: r0.cell_correct } : {}),
    });
  }
  return jsonResponse({
    results,
    progress_pct: progressPct,
    won,
    is_winner: isWinner,
    shared_win: isSharedWin,
  });
});
