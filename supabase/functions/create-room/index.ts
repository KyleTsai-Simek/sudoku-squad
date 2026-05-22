// Edge Function: create-room
//
// Caller is an anonymous Supabase user. We:
//   1. Verify their JWT and pull `auth.uid()` to use as host player_id.
//   2. Validate input (mode + difficulty + initial username).
//   3. Pick a random puzzle of the chosen difficulty.
//   4. Generate a unique room code (retry on collision).
//   5. Insert the room (status = 'lobby') and the host as the first room_player.
//   6. Return { room_code, room_id, player_id, color }.
//
// Service-role client bypasses RLS; we're the authority for this mutation.

import '@supabase/functions-js/edge-runtime.d.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { getCallerUserId, serviceClient } from '../_shared/supabase.ts';
import { generateRoomCode, nextColor } from '../_shared/room-code.ts';

type Mode = 'battle' | 'coop';
type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

const MODES: ReadonlySet<Mode> = new Set(['battle', 'coop']);
const DIFFICULTIES: ReadonlySet<Difficulty> = new Set([
  'easy',
  'medium',
  'hard',
  'expert',
]);

interface CreateRoomInput {
  mode: Mode;
  difficulty: Difficulty;
  username: string;
  is_public?: boolean;
}

function parseInput(body: unknown): CreateRoomInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (!MODES.has(b.mode as Mode)) return null;
  if (!DIFFICULTIES.has(b.difficulty as Difficulty)) return null;
  if (typeof b.username !== 'string') return null;
  const username = b.username.trim();
  if (username.length === 0 || username.length > 20) return null;
  const out: CreateRoomInput = {
    mode: b.mode as Mode,
    difficulty: b.difficulty as Difficulty,
    username,
  };
  if (b.is_public !== undefined) {
    if (typeof b.is_public !== 'boolean') return null;
    out.is_public = b.is_public;
  }
  return out;
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

  let parsed: CreateRoomInput | null;
  try {
    parsed = parseInput(await req.json());
  } catch {
    return errorResponse('bad_request', 'body is not valid JSON');
  }
  if (!parsed) {
    return errorResponse(
      'bad_request',
      'expected { mode: "battle"|"coop", difficulty: "easy"|"medium"|"hard"|"expert", username: 1..20 chars }',
    );
  }
  const { mode, difficulty, username, is_public = false } = parsed;

  const admin = serviceClient();

  // Pick a random puzzle of this difficulty via a small RPC.
  const { data: puzzleCode, error: pickErr } = await admin
    .rpc('pick_random_puzzle_code', { p_difficulty: difficulty });
  if (pickErr) {
    return errorResponse('internal', `puzzle pick failed: ${pickErr.message}`, 500);
  }
  if (!puzzleCode || typeof puzzleCode !== 'string') {
    return errorResponse(
      'not_found',
      `no puzzles available for difficulty=${difficulty}`,
      404,
    );
  }

  // Generate a unique room code, retry on collision.
  let roomId: string | null = null;
  let roomCode: string | null = null;
  const attempts = 5;
  for (let i = 0; i < attempts; i++) {
    const candidate = generateRoomCode();
    const { data, error } = await admin
      .from('rooms')
      .insert({
        code: candidate,
        mode,
        puzzle_code: puzzleCode,
        status: 'lobby',
        settings: {},
        is_public,
      })
      .select('id, code')
      .single();
    if (!error && data) {
      roomId = data.id;
      roomCode = data.code;
      break;
    }
    // 23505 = unique_violation; retry. Other errors: bail.
    if (error && error.code !== '23505') {
      return errorResponse('internal', `rooms insert failed: ${error.message}`, 500);
    }
  }
  if (!roomId || !roomCode) {
    return errorResponse(
      'internal',
      `could not generate unique room code in ${attempts} attempts`,
      500,
    );
  }

  // Insert the host as the first room_player.
  const color = nextColor([]);
  const { error: playerErr } = await admin.from('room_players').insert({
    room_id: roomId,
    player_id: userId,
    username,
    color,
    is_host: true,
  });
  if (playerErr) {
    // Roll back the room so we don't leave it dangling.
    await admin.from('rooms').delete().eq('id', roomId);
    return errorResponse('internal', `host insert failed: ${playerErr.message}`, 500);
  }

  return jsonResponse({
    room_id: roomId,
    room_code: roomCode,
    player_id: userId,
    color,
    mode,
    puzzle_code: puzzleCode,
  });
});
