// Edge Function: change-difficulty
//
// Host-only, lobby-only. Re-picks a random puzzle of the requested
// difficulty and rewrites `rooms.puzzle_code`. Used by the lobby's
// difficulty toggle so the host can change the puzzle for everyone in the
// room before pressing Start.
//
// Why a dedicated function (vs. extending update-room-settings):
//   - The settings patch is conceptually about visual toggles
//     (showConflicts, autoCheck, etc.). Re-picking a puzzle has side
//     effects beyond a single column write — it consults the puzzles
//     table and changes the room's content fingerprint. Keeping it
//     separate makes the intent clear and the audit trail clean.

import '@supabase/functions-js/edge-runtime.d.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { getCallerUserId, serviceClient } from '../_shared/supabase.ts';

const VALID_DIFFICULTIES = new Set([
  'easy',
  'medium',
  'hard',
  'expert',
  'extreme',
  // Note: `killer` is the hidden top tier (DECISIONS #0047). It's a valid
  // value in the DB, but we do NOT accept it from the client — a future
  // "evil mode" reveal will gate access separately.
]);

interface Input {
  room_id: string;
  difficulty: string;
}

function parseInput(body: unknown): Input | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.room_id !== 'string' || b.room_id.length === 0) return null;
  if (typeof b.difficulty !== 'string' || !VALID_DIFFICULTIES.has(b.difficulty)) return null;
  return { room_id: b.room_id, difficulty: b.difficulty };
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') {
    return errorResponse('bad_request', 'POST required', 405);
  }

  const userId = await getCallerUserId(req);
  if (!userId) return errorResponse('unauthenticated', 'missing or invalid JWT', 401);

  let parsed: Input | null;
  try {
    parsed = parseInput(await req.json());
  } catch {
    return errorResponse('bad_request', 'body is not valid JSON');
  }
  if (!parsed) {
    return errorResponse(
      'bad_request',
      'expected { room_id, difficulty: easy|medium|hard|expert|extreme }',
    );
  }

  const admin = serviceClient();

  const { data: room, error: roomErr } = await admin
    .from('rooms')
    .select('id, status, puzzle_code')
    .eq('id', parsed.room_id)
    .maybeSingle();
  if (roomErr) {
    return errorResponse('internal', `room lookup failed: ${roomErr.message}`, 500);
  }
  if (!room) return errorResponse('not_found', 'room not found', 404);
  if (room.status !== 'lobby') {
    return errorResponse(
      'bad_request',
      `difficulty is locked once the room is ${room.status}`,
      409,
    );
  }

  const { data: caller, error: callerErr } = await admin
    .from('room_players')
    .select('is_host')
    .eq('room_id', parsed.room_id)
    .eq('player_id', userId)
    .maybeSingle();
  if (callerErr) {
    return errorResponse('internal', `player lookup failed: ${callerErr.message}`, 500);
  }
  if (!caller) return errorResponse('not_found', 'caller is not in this room', 404);
  if (!caller.is_host) {
    return errorResponse('forbidden', 'only the host can change difficulty', 403);
  }

  // Pick a fresh puzzle of the requested difficulty via the existing RPC.
  const { data: pickedCode, error: pickErr } = await admin.rpc('pick_random_puzzle_code', {
    p_difficulty: parsed.difficulty,
  });
  if (pickErr) {
    return errorResponse('internal', `puzzle pick failed: ${pickErr.message}`, 500);
  }
  if (!pickedCode || typeof pickedCode !== 'string') {
    return errorResponse('not_found', `no ${parsed.difficulty} puzzles available`, 404);
  }

  const { error: updErr } = await admin
    .from('rooms')
    .update({ puzzle_code: pickedCode })
    .eq('id', parsed.room_id);
  if (updErr) {
    return errorResponse('internal', `update failed: ${updErr.message}`, 500);
  }

  return jsonResponse({ puzzle_code: pickedCode, difficulty: parsed.difficulty });
});
