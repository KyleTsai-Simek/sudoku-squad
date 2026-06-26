// Edge Function: merge-progress
//
// Unions an abandoned ANONYMOUS identity's progress into the caller's account
// ([DECISIONS.md #0043]). This is the cross-device case: a player solved
// puzzles anonymously on a new device, then signed into an account that already
// existed elsewhere. Supabase can't merge two user IDs, so the client signs
// into the account (the destination) and hands us the source anon access token
// (captured before its session was replaced) to reconcile.
//
// Security model:
//   - dest  = the caller (Authorization header JWT). Must be a real account
//             (non-anonymous) — you can only merge INTO your own account.
//   - source = the user behind `source_token` in the body. Must be ANONYMOUS
//             and distinct from dest.
// These two guards mean a caller cannot claim another permanent account's
// progress: the source must be an anonymous identity whose token they hold, and
// the destination must be themselves.
//
// Effects (idempotent — safe to retry):
//   1. Upsert source `player_completions` into dest (on conflict do nothing).
//   2. Delete the source's `player_completions` + `issued_usernames` row
//      (frees that username).
//   3. Delete the now-empty anonymous auth user (best-effort).
// Historical `room_players` / `moves` rows for the source are left as-is
// (no FK to auth.users; they're an immutable game log).

import '@supabase/functions-js/edge-runtime.d.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { getCaller, getUserFromToken, serviceClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') {
    return errorResponse('bad_request', 'POST required', 405);
  }

  const dest = await getCaller(req);
  if (!dest) {
    return errorResponse('unauthenticated', 'missing or invalid JWT', 401);
  }
  if (dest.isAnonymous) {
    return errorResponse('forbidden', 'destination must be a signed-in account', 403);
  }

  let body: { source_token?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse('bad_request', 'invalid JSON body', 400);
  }
  if (typeof body.source_token !== 'string' || body.source_token.length === 0) {
    return errorResponse('bad_request', 'source_token (string) required', 400);
  }

  const source = await getUserFromToken(body.source_token);
  if (!source) {
    return errorResponse('bad_request', 'invalid or expired source_token', 400);
  }
  if (source.id === dest.id) {
    // Same identity (e.g. first-time link kept the same uid) — nothing to merge.
    return jsonResponse({ merged: false, moved_completions: 0, reason: 'same_identity' });
  }
  if (!source.isAnonymous) {
    return errorResponse('forbidden', 'source must be an anonymous identity', 403);
  }

  const admin = serviceClient();

  // 1. Read the source's completions and upsert them onto the dest account.
  const srcCompletions = await admin
    .from('player_completions')
    .select('puzzle_code, mode, completed_at, solve_time_ms')
    .eq('player_id', source.id);
  if (srcCompletions.error) {
    return errorResponse('internal', `read source completions failed: ${srcCompletions.error.message}`, 500);
  }
  const rows = srcCompletions.data ?? [];

  if (rows.length > 0) {
    const merged = rows.map((r) => ({
      player_id: dest.id,
      puzzle_code: r.puzzle_code,
      mode: r.mode,
      completed_at: r.completed_at,
      solve_time_ms: r.solve_time_ms,
    }));
    const up = await admin
      .from('player_completions')
      .upsert(merged, { onConflict: 'player_id,puzzle_code', ignoreDuplicates: true });
    if (up.error) {
      return errorResponse('internal', `merge upsert failed: ${up.error.message}`, 500);
    }
  }

  const srcDailyCompletions = await admin
    .from('player_daily_completions')
    .select('puzzle_date, difficulty, puzzle_code, completed_at, solve_time_ms, created_at')
    .eq('player_id', source.id);
  if (srcDailyCompletions.error) {
    return errorResponse('internal', `read source daily completions failed: ${srcDailyCompletions.error.message}`, 500);
  }
  const dailyRows = srcDailyCompletions.data ?? [];

  if (dailyRows.length > 0) {
    const mergedDaily = dailyRows.map((r) => ({
      player_id: dest.id,
      puzzle_date: r.puzzle_date,
      difficulty: r.difficulty,
      puzzle_code: r.puzzle_code,
      completed_at: r.completed_at,
      solve_time_ms: r.solve_time_ms,
      created_at: r.created_at,
    }));
    const up = await admin
      .from('player_daily_completions')
      .upsert(mergedDaily, {
        onConflict: 'player_id,puzzle_date,difficulty',
        ignoreDuplicates: true,
      });
    if (up.error) {
      return errorResponse('internal', `merge daily upsert failed: ${up.error.message}`, 500);
    }
  }

  // 2. Tear down the source identity's data. The username row first (frees the
  //    name), then completions.
  const delName = await admin.from('issued_usernames').delete().eq('player_id', source.id);
  if (delName.error) {
    return errorResponse('internal', `release source username failed: ${delName.error.message}`, 500);
  }
  const delDailyCompletions = await admin
    .from('player_daily_completions')
    .delete()
    .eq('player_id', source.id);
  if (delDailyCompletions.error) {
    return errorResponse('internal', `delete source daily completions failed: ${delDailyCompletions.error.message}`, 500);
  }
  const delCompletions = await admin.from('player_completions').delete().eq('player_id', source.id);
  if (delCompletions.error) {
    return errorResponse('internal', `delete source completions failed: ${delCompletions.error.message}`, 500);
  }

  // 3. Delete the orphaned anonymous auth user (best-effort; the merge has
  //    already succeeded above, so a failure here is non-fatal).
  const delUser = await admin.auth.admin.deleteUser(source.id);
  if (delUser.error) {
    console.error('merge-progress: deleteUser failed (non-fatal)', delUser.error.message);
  }

  return jsonResponse({
    merged: true,
    moved_completions: rows.length,
    moved_daily_completions: dailyRows.length,
  });
});
