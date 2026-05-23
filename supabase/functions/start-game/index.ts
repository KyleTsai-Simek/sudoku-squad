// Edge Function: start-game
//
// Host-only. Two flavors of "start":
//   - First start: room.status='lobby', puzzle_code already chosen on create.
//     Just transitions to 'playing' + sets started_at.
//   - Replay: room cycled back to 'lobby' after a previous game (per DECISIONS
//     #0030). Refuses if any room_players.has_returned=false. On success:
//     clears `moves`, picks a NEW random puzzle_code for the room's difficulty
//     (inferred from the current puzzle), resets progress_pct/winner/finished_at,
//     sets a fresh started_at, transitions to 'playing'.

import '@supabase/functions-js/edge-runtime.d.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { getCallerUserId, serviceClient } from '../_shared/supabase.ts';

const MIN_BATTLE_PLAYERS = 2;

interface StartGameInput {
  room_id: string;
}

function parseInput(body: unknown): StartGameInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.room_id !== 'string' || b.room_id.length === 0) return null;
  return { room_id: b.room_id };
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') {
    return errorResponse('bad_request', 'POST required', 405);
  }

  const userId = await getCallerUserId(req);
  if (!userId) {
    return errorResponse('unauthenticated', 'missing or invalid JWT', 401);
  }

  let parsed: StartGameInput | null;
  try {
    parsed = parseInput(await req.json());
  } catch {
    return errorResponse('bad_request', 'body is not valid JSON');
  }
  if (!parsed) {
    return errorResponse('bad_request', 'expected { room_id: string }');
  }

  const admin = serviceClient();

  const { data: room, error: roomErr } = await admin
    .from('rooms')
    .select('id, mode, status, puzzle_code')
    .eq('id', parsed.room_id)
    .maybeSingle();
  if (roomErr) {
    return errorResponse('internal', `room lookup failed: ${roomErr.message}`, 500);
  }
  if (!room) return errorResponse('not_found', `no room with id ${parsed.room_id}`, 404);

  if (room.status !== 'lobby') {
    return errorResponse(
      'bad_request',
      `room is already ${room.status}; can only start from lobby`,
      409,
    );
  }

  // Host check.
  const { data: caller, error: callerErr } = await admin
    .from('room_players')
    .select('is_host')
    .eq('room_id', room.id)
    .eq('player_id', userId)
    .maybeSingle();
  if (callerErr) {
    return errorResponse('internal', `player lookup failed: ${callerErr.message}`, 500);
  }
  if (!caller) return errorResponse('not_found', 'caller is not in this room', 404);
  if (!caller.is_host) {
    return errorResponse('forbidden', 'only the host can start the game', 403);
  }

  // Load all players (used for cap check + has_returned validation).
  const { data: players, error: playersErr } = await admin
    .from('room_players')
    .select('player_id, has_returned')
    .eq('room_id', room.id);
  if (playersErr) {
    return errorResponse('internal', `players read failed: ${playersErr.message}`, 500);
  }
  const allPlayers = players ?? [];
  if (room.mode === 'battle' && allPlayers.length < MIN_BATTLE_PLAYERS) {
    return errorResponse(
      'too_few_players',
      `battle needs at least ${MIN_BATTLE_PLAYERS} players`,
      409,
    );
  }
  const stragglers = allPlayers.filter((p) => !p.has_returned);
  if (stragglers.length > 0) {
    return errorResponse(
      'players_not_ready',
      `${stragglers.length} player(s) haven't returned to the lobby yet`,
      409,
    );
  }

  // Look up current puzzle's difficulty to roll a fresh puzzle for this round.
  const { data: prevPuzzle, error: prevErr } = await admin
    .from('puzzles')
    .select('difficulty')
    .eq('code', room.puzzle_code)
    .maybeSingle();
  if (prevErr || !prevPuzzle) {
    return errorResponse(
      'internal',
      `puzzle lookup failed: ${prevErr?.message ?? 'no row'}`,
      500,
    );
  }
  const { data: nextCode, error: pickErr } = await admin.rpc('pick_random_puzzle_code', {
    p_difficulty: prevPuzzle.difficulty,
  });
  if (pickErr || !nextCode) {
    return errorResponse('internal', `next puzzle pick failed: ${pickErr?.message ?? 'none'}`, 500);
  }

  // Wipe previous-round state. Order matters — clear moves before the room
  // update since moves.room_id is on cascade-delete already (room stays).
  const { error: delMovesErr } = await admin.from('moves').delete().eq('room_id', room.id);
  if (delMovesErr) {
    return errorResponse('internal', `moves clear failed: ${delMovesErr.message}`, 500);
  }
  const { error: resetPlayersErr } = await admin
    .from('room_players')
    .update({ progress_pct: 0 })
    .eq('room_id', room.id);
  if (resetPlayersErr) {
    return errorResponse(
      'internal',
      `room_players reset failed: ${resetPlayersErr.message}`,
      500,
    );
  }

  const startedAt = new Date().toISOString();
  const { error: updErr } = await admin
    .from('rooms')
    .update({
      status: 'playing',
      puzzle_code: nextCode,
      started_at: startedAt,
      finished_at: null,
      winner_player_id: null,
      // Reset the per-room seq counter so the new round's moves start at 1.
      // Old moves were just wiped above; next_seq is the only piece of seq
      // state that survives the round flip and would otherwise grow forever.
      next_seq: 1,
    })
    .eq('id', room.id);
  if (updErr) {
    return errorResponse('internal', `room update failed: ${updErr.message}`, 500);
  }

  return jsonResponse({
    room_id: room.id,
    status: 'playing',
    started_at: startedAt,
    puzzle_code: nextCode,
  });
});
