// Edge Function: return-to-lobby
//
// Caller is signaling "I'm done with that game, ready for the next round".
//   1. Set caller's has_returned = true and progress_pct = 0.
//   2. If the room is still 'finished', transition it back to 'lobby'
//      (idempotent — first returner triggers it, later returners are no-ops).
//
// Players who haven't returned remain has_returned=false. The host's
// start-game refuses until everyone is true (or kicked).

import '@supabase/functions-js/edge-runtime.d.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { getCallerUserId, serviceClient } from '../_shared/supabase.ts';

interface Input {
  room_id: string;
}

function parseInput(body: unknown): Input | null {
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
  if (!userId) return errorResponse('unauthenticated', 'missing or invalid JWT', 401);

  let parsed: Input | null;
  try {
    parsed = parseInput(await req.json());
  } catch {
    return errorResponse('bad_request', 'body is not valid JSON');
  }
  if (!parsed) {
    return errorResponse('bad_request', 'expected { room_id }');
  }

  const admin = serviceClient();

  const { data: caller, error: callerErr } = await admin
    .from('room_players')
    .select('player_id')
    .eq('room_id', parsed.room_id)
    .eq('player_id', userId)
    .maybeSingle();
  if (callerErr) {
    return errorResponse('internal', `caller lookup failed: ${callerErr.message}`, 500);
  }
  if (!caller) return errorResponse('not_found', 'caller is not in this room', 404);

  const now = new Date().toISOString();

  const { error: hrErr } = await admin
    .from('room_players')
    .update({
      has_returned: true,
      progress_pct: 0,
      lobby_confirmed_at: now,
      last_seen_at: now,
    })
    .eq('room_id', parsed.room_id)
    .eq('player_id', userId);
  if (hrErr) {
    return errorResponse('internal', `return-to-lobby update failed: ${hrErr.message}`, 500);
  }

  // Room transition is idempotent. Only succeeds when status='finished'.
  const { data: rm } = await admin
    .from('rooms')
    .update({ status: 'lobby' })
    .eq('id', parsed.room_id)
    .eq('status', 'finished')
    .select('status')
    .maybeSingle();

  return jsonResponse({
    has_returned: true,
    room_status: rm?.status ?? null,
  });
});
