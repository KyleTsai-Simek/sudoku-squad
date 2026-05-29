// Edge Function: join-room
//
//   1. Authenticate caller via JWT → player_id.
//   2. Look up the room by code.
//   3. If the caller already has a seat (rejoin), return it as-is —
//      regardless of room status. A mid-battle refresh must land the player
//      back in their game, not bounce off the in-progress gate. This is what
//      makes refreshes idempotent and keeps the disconnect-grace flow simple.
//   4. Otherwise apply the NEW-joiner mid-game policy (per DECISIONS.md #0024):
//        - status=finished → 'room_finished'.
//        - status=playing AND mode=battle → 'room_in_progress'.
//        - status=playing AND mode=coop → OK (coop is open anytime).
//        - status=lobby → OK.
//   5. Enforce room cap (8 players) when adding a new joiner.
//   6. Otherwise pick a color from the unused palette slots and insert.

import '@supabase/functions-js/edge-runtime.d.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { getCallerUserId, serviceClient } from '../_shared/supabase.ts';
import { nextColor } from '../_shared/room-code.ts';

const MAX_PLAYERS = 8;

interface JoinRoomInput {
  code: string;
  username: string;
}

function parseInput(body: unknown): JoinRoomInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.code !== 'string' || b.code.length === 0) return null;
  if (typeof b.username !== 'string') return null;
  const username = b.username.trim();
  if (username.length === 0 || username.length > 20) return null;
  return { code: b.code, username };
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

  let parsed: JoinRoomInput | null;
  try {
    parsed = parseInput(await req.json());
  } catch {
    return errorResponse('bad_request', 'body is not valid JSON');
  }
  if (!parsed) {
    return errorResponse('bad_request', 'expected { code: string, username: 1..20 chars }');
  }
  const { code, username } = parsed;

  const admin = serviceClient();

  // Look up the room.
  const { data: room, error: roomErr } = await admin
    .from('rooms')
    .select('id, code, mode, status, puzzle_code')
    .eq('code', code)
    .maybeSingle();
  if (roomErr) {
    return errorResponse('internal', `room lookup failed: ${roomErr.message}`, 500);
  }
  if (!room) {
    return errorResponse('not_found', `no room with code "${code}"`, 404);
  }

  // Load current players.
  const { data: players, error: playersErr } = await admin
    .from('room_players')
    .select('player_id, color, username, is_host')
    .eq('room_id', room.id);
  if (playersErr) {
    return errorResponse('internal', `room_players read failed: ${playersErr.message}`, 500);
  }

  // Rejoin? Caller already has a seat — return it as-is, regardless of room
  // status. This MUST run before the mid-game-join gate below: a player who
  // refreshes mid-battle (or revisits a finished room) owns their seat and has
  // to be let back in, otherwise the in-progress gate would bounce them to an
  // error page and their game would appear lost. See DECISIONS.md #0024.
  const existing = (players ?? []).find((p) => p.player_id === userId);
  if (existing) {
    return jsonResponse({
      room_id: room.id,
      room_code: room.code,
      mode: room.mode,
      status: room.status,
      puzzle_code: room.puzzle_code,
      player_id: userId,
      color: existing.color,
      is_host: existing.is_host,
      rejoined: true,
    });
  }

  // New-joiner mid-game policy.
  if (room.status === 'finished') {
    return errorResponse('room_finished', 'this room is already over', 409);
  }
  if (room.status === 'playing' && room.mode === 'battle') {
    return errorResponse('room_in_progress', 'this battle has already started', 409);
  }

  // New joiner: enforce cap.
  if ((players?.length ?? 0) >= MAX_PLAYERS) {
    return errorResponse('room_full', `room is at the ${MAX_PLAYERS}-player limit`, 409);
  }

  const color = nextColor((players ?? []).map((p) => p.color));
  const { error: insertErr } = await admin.from('room_players').insert({
    room_id: room.id,
    player_id: userId,
    username,
    color,
    is_host: false,
  });
  if (insertErr) {
    // 23505 unique_violation on (room_id, player_id) is the race-condition path
    // where two simultaneous joins from the same user collide. Treat as rejoin.
    if (insertErr.code === '23505') {
      return jsonResponse({
        room_id: room.id,
        room_code: room.code,
        mode: room.mode,
        status: room.status,
        puzzle_code: room.puzzle_code,
        player_id: userId,
        color,
        is_host: false,
        rejoined: true,
      });
    }
    return errorResponse('internal', `room_players insert failed: ${insertErr.message}`, 500);
  }

  return jsonResponse({
    room_id: room.id,
    room_code: room.code,
    mode: room.mode,
    status: room.status,
    puzzle_code: room.puzzle_code,
    player_id: userId,
    color,
    is_host: false,
    rejoined: false,
  });
});
