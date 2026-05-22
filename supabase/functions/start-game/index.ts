// Edge Function: start-game
//
//   1. Authenticate caller.
//   2. Verify caller is the host of the named room.
//   3. Refuse if status is not 'lobby'.
//   4. In battle, require ≥ 2 players. (Coop is OK solo, but battle solo is weird.)
//   5. Set status = 'playing', started_at = now(). The Realtime publication on
//      `rooms` fans the change out to subscribers.

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

  // Load room + caller's room_player row in two cheap queries.
  const { data: room, error: roomErr } = await admin
    .from('rooms')
    .select('id, mode, status, started_at')
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

  // Battle requires at least 2 players (no point racing yourself).
  if (room.mode === 'battle') {
    const { count, error: cntErr } = await admin
      .from('room_players')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', room.id);
    if (cntErr) {
      return errorResponse('internal', `player count failed: ${cntErr.message}`, 500);
    }
    if ((count ?? 0) < MIN_BATTLE_PLAYERS) {
      return errorResponse(
        'too_few_players',
        `battle needs at least ${MIN_BATTLE_PLAYERS} players`,
        409,
      );
    }
  }

  const startedAt = new Date().toISOString();
  const { error: updErr } = await admin
    .from('rooms')
    .update({ status: 'playing', started_at: startedAt })
    .eq('id', room.id);
  if (updErr) {
    return errorResponse('internal', `room update failed: ${updErr.message}`, 500);
  }

  return jsonResponse({
    room_id: room.id,
    status: 'playing',
    started_at: startedAt,
  });
});
