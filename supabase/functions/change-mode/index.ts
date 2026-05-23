// Edge Function: change-mode
//
// Host-only, lobby-only. Flips `rooms.mode` between 'battle' and 'coop'.
// Used by the lobby's mode toggle so the host can switch the room mode
// before pressing Start.
//
// No puzzle re-pick required — the puzzle field is mode-agnostic. The
// client decides which gameplay surface to render based on the (live)
// room mode.
//
// Why a dedicated function (vs. update-room-settings): mode is the
// fundamental room shape (battle vs coop has different RLS implications
// for `moves` visibility and different gameplay rules). Keeping the
// intent isolated in its own function makes the audit trail clean and
// matches the pattern used by change-difficulty.

import '@supabase/functions-js/edge-runtime.d.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { getCallerUserId, serviceClient } from '../_shared/supabase.ts';

const VALID_MODES = new Set(['battle', 'coop']);

interface Input {
  room_id: string;
  mode: string;
}

function parseInput(body: unknown): Input | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.room_id !== 'string' || b.room_id.length === 0) return null;
  if (typeof b.mode !== 'string' || !VALID_MODES.has(b.mode)) return null;
  return { room_id: b.room_id, mode: b.mode };
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
      'expected { room_id, mode: battle|coop }',
    );
  }

  const admin = serviceClient();

  const { data: room, error: roomErr } = await admin
    .from('rooms')
    .select('id, status, mode')
    .eq('id', parsed.room_id)
    .maybeSingle();
  if (roomErr) {
    return errorResponse('internal', `room lookup failed: ${roomErr.message}`, 500);
  }
  if (!room) return errorResponse('not_found', 'room not found', 404);
  if (room.status !== 'lobby') {
    return errorResponse(
      'bad_request',
      `mode is locked once the room is ${room.status}`,
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
    return errorResponse('forbidden', 'only the host can change mode', 403);
  }

  // No-op if already at the requested mode — return success so the client's
  // optimistic UI doesn't flap.
  if (room.mode === parsed.mode) {
    return jsonResponse({ mode: parsed.mode, changed: false });
  }

  const { error: updErr } = await admin
    .from('rooms')
    .update({ mode: parsed.mode })
    .eq('id', parsed.room_id);
  if (updErr) {
    return errorResponse('internal', `update failed: ${updErr.message}`, 500);
  }

  return jsonResponse({ mode: parsed.mode, changed: true });
});
