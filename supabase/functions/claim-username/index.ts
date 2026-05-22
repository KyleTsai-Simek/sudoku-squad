// Edge Function: claim-username
//
// Per [DECISIONS.md #0027], every player gets a globally-unique adj-noun name
// from the bundled wordlist. The function is idempotent for a given auth.uid():
// calling it again returns the same name.
//
// Algorithm:
//   1. If caller already has a row in `issued_usernames`, return it.
//   2. Try up to MAX_RANDOM random adj+noun pairs. Insert with unique
//      constraint as the safety net for concurrent claims of the same name.
//   3. If all random attempts collide (vanishingly unlikely at 440k combos),
//      fall back to "adj-noun-NNNN" with a random 4-digit suffix, retried.
//   4. If even that fails, generate a 6-char base36 random handle.

import '@supabase/functions-js/edge-runtime.d.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { getCallerUserId, serviceClient } from '../_shared/supabase.ts';

import wordList from '../_shared/word-lists.generated.json' with { type: 'json' };

const ADJECTIVES: readonly string[] = wordList.adjectives;
const NOUNS: readonly string[] = wordList.nouns;

const MAX_RANDOM = 10;
const MAX_SUFFIX_ATTEMPTS = 10;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randomCombo(): string {
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}`;
}

function fallbackRandom(): string {
  // Last-resort handle that's almost certainly free. 6 chars base36 → 2.18B.
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let n = 0n;
  for (const b of buf) n = (n << 8n) | BigInt(b);
  return `guest-${(n % (36n ** 6n)).toString(36).padStart(6, '0')}`;
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

  const admin = serviceClient();

  // 1. Already claimed?
  const existing = await admin
    .from('issued_usernames')
    .select('username')
    .eq('player_id', userId)
    .maybeSingle();
  if (existing.error) {
    return errorResponse('internal', `select failed: ${existing.error.message}`, 500);
  }
  if (existing.data?.username) {
    return jsonResponse({ username: existing.data.username, fresh: false });
  }

  // 2. Random adj+noun attempts.
  for (let i = 0; i < MAX_RANDOM; i++) {
    const candidate = randomCombo();
    const ins = await admin
      .from('issued_usernames')
      .insert({ player_id: userId, username: candidate })
      .select('username')
      .maybeSingle();
    if (!ins.error && ins.data) {
      return jsonResponse({ username: ins.data.username, fresh: true });
    }
    // 23505 = unique_violation. Could be on player_id (raced our own select)
    // or on username (someone else got there). Either way we re-check player_id
    // and bail or retry.
    if (ins.error?.code === '23505') {
      const re = await admin
        .from('issued_usernames')
        .select('username')
        .eq('player_id', userId)
        .maybeSingle();
      if (re.data?.username) {
        return jsonResponse({ username: re.data.username, fresh: false });
      }
      continue; // collision on username — try a new pair
    }
    return errorResponse('internal', `insert failed: ${ins.error?.message ?? 'unknown'}`, 500);
  }

  // 3. Random suffix on top of a fresh pair.
  for (let i = 0; i < MAX_SUFFIX_ATTEMPTS; i++) {
    const candidate = `${randomCombo()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const ins = await admin
      .from('issued_usernames')
      .insert({ player_id: userId, username: candidate })
      .select('username')
      .maybeSingle();
    if (!ins.error && ins.data) {
      return jsonResponse({ username: ins.data.username, fresh: true });
    }
    if (ins.error?.code !== '23505') {
      return errorResponse('internal', `insert failed: ${ins.error?.message ?? 'unknown'}`, 500);
    }
  }

  // 4. Last resort.
  const candidate = fallbackRandom();
  const ins = await admin
    .from('issued_usernames')
    .insert({ player_id: userId, username: candidate })
    .select('username')
    .maybeSingle();
  if (ins.error) {
    return errorResponse('internal', `final insert failed: ${ins.error.message}`, 500);
  }
  return jsonResponse({ username: ins.data!.username, fresh: true });
});
