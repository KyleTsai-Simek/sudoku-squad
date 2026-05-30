// Edge Function: set-username
//
// Signed-in-only username change ([DECISIONS.md #0043]). Anonymous callers are
// rejected (the UI routes them to sign-in instead).
//
// Discord-style handles: the caller picks a `base`; if the bare base is free
// they get it, otherwise a random `#NNNN` discriminator is appended. The
// discriminator is drawn randomly from the smallest non-full width (4 digits →
// 5 → …). Changing away frees the caller's previous (base, discriminator) tuple
// automatically, because we UPDATE the caller's single row in place.
//
// Uniqueness is enforced by the `(lower(base), coalesce(discriminator,0))`
// index (migration 0018); a concurrent claim surfaces as 23505 and we retry the
// whole allocation against fresh data.

import '@supabase/functions-js/edge-runtime.d.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { getCaller, serviceClient } from '../_shared/supabase.ts';
// Single source of truth for base validation + discriminator allocation, shared
// with the property tests in core ([DECISIONS #0043]). Self-contained module,
// imported with an explicit extension for Deno.
import {
  normalizeBase,
  pickDiscriminator,
  validateBase,
} from '../../../packages/core/src/username/discriminator.ts';

const MAX_ALLOC_RETRIES = 6;

/** Escape LIKE/ILIKE wildcards so a base containing `_` matches literally. */
function escapeLike(s: string): string {
  return s.replace(/([%_\\])/g, '\\$1');
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') {
    return errorResponse('bad_request', 'POST required', 405);
  }

  const caller = await getCaller(req);
  if (!caller) {
    return errorResponse('unauthenticated', 'missing or invalid JWT', 401);
  }
  if (caller.isAnonymous) {
    return errorResponse('forbidden', 'sign in to change your username', 403);
  }

  let body: { username?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse('bad_request', 'invalid JSON body', 400);
  }
  if (typeof body.username !== 'string') {
    return errorResponse('bad_request', 'username (string) required', 400);
  }

  const base = normalizeBase(body.username);
  const validationError = validateBase(base);
  if (validationError) {
    return errorResponse('bad_request', validationError, 400);
  }

  const admin = serviceClient();
  const uid = caller.id;

  for (let attempt = 0; attempt < MAX_ALLOC_RETRIES; attempt++) {
    // Read every current holder of this base (case-insensitive exact match).
    const { data: rows, error: readErr } = await admin
      .from('issued_usernames')
      .select('player_id, discriminator')
      .ilike('base', escapeLike(base));
    if (readErr) {
      return errorResponse('internal', `read failed: ${readErr.message}`, 500);
    }

    const others = (rows ?? []).filter((r) => r.player_id !== uid);
    const bareTaken = others.some((r) => r.discriminator === null);

    let discriminator: number | null;
    if (!bareTaken) {
      discriminator = null;
    } else {
      const used = new Set<number>(
        others.map((r) => r.discriminator).filter((d): d is number => d !== null),
      );
      discriminator = pickDiscriminator(used);
      if (discriminator === null) {
        return errorResponse('internal', 'no free discriminator for this name', 500);
      }
    }

    // Upsert the caller's single row (insert if they somehow have none yet).
    const upd = await admin
      .from('issued_usernames')
      .upsert({ player_id: uid, base, discriminator }, { onConflict: 'player_id' })
      .select('username, base, discriminator')
      .maybeSingle();

    if (!upd.error && upd.data) {
      return jsonResponse(upd.data);
    }
    if (upd.error?.code === '23505') {
      continue; // raced a concurrent claim — re-read and reallocate
    }
    return errorResponse('internal', `update failed: ${upd.error?.message ?? 'unknown'}`, 500);
  }

  return errorResponse('internal', 'could not allocate a unique username, try again', 500);
});
