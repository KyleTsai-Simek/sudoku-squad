// Edge Function: confirm-room-presence
//
// Marks the caller's durable room_players row as a confirmed visible lobby
// participant. The client delays this call briefly so transient mobile
// in-app-browser hops do not appear to hosts as real players. Active clients
// also use this heartbeat to trigger server-side host handoff when the current
// lobby host has gone stale.

import '@supabase/functions-js/edge-runtime.d.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { getCallerUserId, serviceClient } from '../_shared/supabase.ts';

const HOST_INACTIVE_MS = 30_000;

interface ConfirmRoomPresenceInput {
  room_id: string;
}

function parseInput(body: unknown): ConfirmRoomPresenceInput | null {
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

  let parsed: ConfirmRoomPresenceInput | null;
  try {
    parsed = parseInput(await req.json());
  } catch {
    return errorResponse('bad_request', 'body is not valid JSON');
  }
  if (!parsed) {
    return errorResponse('bad_request', 'expected { room_id: string }');
  }

  const admin = serviceClient();
  const now = new Date().toISOString();
  const { data: existing, error: readErr } = await admin
    .from('room_players')
    .select('lobby_confirmed_at')
    .eq('room_id', parsed.room_id)
    .eq('player_id', userId)
    .maybeSingle();

  if (readErr) {
    return errorResponse('internal', `room_players read failed: ${readErr.message}`, 500);
  }
  if (!existing) {
    return errorResponse('forbidden', 'caller is not in this room', 403);
  }

  const { error: updateErr } = await admin
    .from('room_players')
    .update({
      lobby_confirmed_at: existing.lobby_confirmed_at ?? now,
      last_seen_at: now,
    })
    .eq('room_id', parsed.room_id)
    .eq('player_id', userId);

  if (updateErr) {
    return errorResponse('internal', `presence update failed: ${updateErr.message}`, 500);
  }

  const inactiveAfter = new Date(Date.now() - HOST_INACTIVE_MS).toISOString();
  const { data: handoff, error: handoffErr } = await admin
    .rpc('reassign_inactive_lobby_host', {
      p_room_id: parsed.room_id,
      p_inactive_after: inactiveAfter,
    })
    .maybeSingle();

  if (handoffErr) {
    return errorResponse('internal', `host handoff failed: ${handoffErr.message}`, 500);
  }

  return jsonResponse({
    room_id: parsed.room_id,
    player_id: userId,
    lobby_confirmed_at: existing.lobby_confirmed_at ?? now,
    last_seen_at: now,
    host_handoff: handoff ?? null,
  });
});
