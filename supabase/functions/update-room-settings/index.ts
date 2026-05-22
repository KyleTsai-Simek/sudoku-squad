// Edge Function: update-room-settings
//
// Host-only. Settings are mutable only while `room.status='lobby'`. Once
// the game starts, the panel becomes read-only client-side and any further
// call here is refused server-side.
//
// Accepts a partial settings patch — only the provided keys are updated.
// is_public also lives in the settings panel UI but is a column on `rooms`,
// not in `settings` jsonb; we handle both here for symmetry.

import '@supabase/functions-js/edge-runtime.d.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { getCallerUserId, serviceClient } from '../_shared/supabase.ts';
import { normalizeSettings, type RoomSettings } from '../_shared/settings.ts';

interface Input {
  room_id: string;
  settings?: Partial<RoomSettings>;
  is_public?: boolean;
}

function parseInput(body: unknown): Input | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.room_id !== 'string' || b.room_id.length === 0) return null;
  const out: Input = { room_id: b.room_id };
  if (b.settings !== undefined) {
    if (!b.settings || typeof b.settings !== 'object') return null;
    out.settings = b.settings as Partial<RoomSettings>;
  }
  if (b.is_public !== undefined) {
    if (typeof b.is_public !== 'boolean') return null;
    out.is_public = b.is_public;
  }
  if (out.settings === undefined && out.is_public === undefined) return null;
  return out;
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
      'expected { room_id, settings?: {...}, is_public?: boolean }',
    );
  }

  const admin = serviceClient();

  const { data: room, error: roomErr } = await admin
    .from('rooms')
    .select('id, status, settings, is_public')
    .eq('id', parsed.room_id)
    .maybeSingle();
  if (roomErr) {
    return errorResponse('internal', `room lookup failed: ${roomErr.message}`, 500);
  }
  if (!room) return errorResponse('not_found', 'room not found', 404);
  if (room.status !== 'lobby') {
    return errorResponse(
      'bad_request',
      `settings are locked once the room is ${room.status}`,
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
    return errorResponse('forbidden', 'only the host can change settings', 403);
  }

  const merged = parsed.settings
    ? normalizeSettings({
        ...(room.settings as Record<string, unknown>),
        ...parsed.settings,
      })
    : normalizeSettings(room.settings);
  const nextIsPublic =
    parsed.is_public !== undefined ? parsed.is_public : (room.is_public as boolean);

  const patch: Record<string, unknown> = {};
  if (parsed.settings) patch.settings = merged;
  if (parsed.is_public !== undefined) patch.is_public = parsed.is_public;

  const { error: updErr } = await admin
    .from('rooms')
    .update(patch)
    .eq('id', parsed.room_id);
  if (updErr) {
    return errorResponse('internal', `update failed: ${updErr.message}`, 500);
  }

  return jsonResponse({ settings: merged, is_public: nextIsPublic });
});
