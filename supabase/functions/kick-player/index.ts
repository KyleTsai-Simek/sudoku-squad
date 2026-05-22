// Edge Function: kick-player
//
// Host-only. Removes a target player from the room. The target's existing
// Realtime subscription on `room_players` sees a DELETE event and the client
// redirects them home. The host cannot kick themselves; refuses with 422 if
// player_id === caller.

import '@supabase/functions-js/edge-runtime.d.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { getCallerUserId, serviceClient } from '../_shared/supabase.ts';

interface Input {
  room_id: string;
  player_id: string;
}

function parseInput(body: unknown): Input | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.room_id !== 'string' || b.room_id.length === 0) return null;
  if (typeof b.player_id !== 'string' || b.player_id.length === 0) return null;
  return { room_id: b.room_id, player_id: b.player_id };
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
    return errorResponse('bad_request', 'expected { room_id, player_id }');
  }
  if (parsed.player_id === userId) {
    return errorResponse('bad_request', 'cannot kick yourself', 422);
  }

  const admin = serviceClient();

  const { data: caller, error: callerErr } = await admin
    .from('room_players')
    .select('is_host')
    .eq('room_id', parsed.room_id)
    .eq('player_id', userId)
    .maybeSingle();
  if (callerErr) {
    return errorResponse('internal', `caller lookup failed: ${callerErr.message}`, 500);
  }
  if (!caller) return errorResponse('not_found', 'caller is not in this room', 404);
  if (!caller.is_host) {
    return errorResponse('forbidden', 'only the host can kick players', 403);
  }

  const { data: deleted, error: delErr } = await admin
    .from('room_players')
    .delete()
    .eq('room_id', parsed.room_id)
    .eq('player_id', parsed.player_id)
    .select('player_id')
    .maybeSingle();
  if (delErr) {
    return errorResponse('internal', `kick failed: ${delErr.message}`, 500);
  }
  if (!deleted) {
    return errorResponse('not_found', 'target is not in this room', 404);
  }

  return jsonResponse({ kicked: true, player_id: parsed.player_id });
});
