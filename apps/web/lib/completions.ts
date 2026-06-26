'use client';

import { ensureAuthClient, getSupabase } from './supabase';
import type { PuzzleCode } from '@sudoku-squad/core';

/**
 * Server-side completion tracking. Per [DECISIONS.md #0028] this replaces the
 * legacy localStorage-only `solved-tracker.ts`. Reads use the caller's anon
 * JWT (RLS-gated to own rows); writes go through the SECURITY DEFINER RPC
 * `record_single_player_completion` (single-player) or `submit-move` (multiplayer).
 *
 * Local in-memory cache so the home page and pick-puzzle filter don't
 * round-trip on every render.
 */

let _cache: Set<PuzzleCode> | null = null;
let _cachedAt = 0;
const CACHE_MS = 30_000;

/** Force a re-fetch on the next get. Call after a completion is recorded. */
export function invalidateCompletionsCache(): void {
  _cache = null;
  _cachedAt = 0;
}

/** Fetch the caller's completed puzzle codes. Caches in memory. */
export async function getCompletedSet(): Promise<Set<PuzzleCode>> {
  const now = Date.now();
  if (_cache && now - _cachedAt < CACHE_MS) return _cache;

  const client = getSupabase();
  if (!client) {
    _cache = new Set();
    _cachedAt = now;
    return _cache;
  }

  const out = new Set<PuzzleCode>();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client
      .from('player_completions')
      .select('puzzle_code')
      .range(offset, offset + PAGE - 1);
    if (error) {
      // RLS reads return [] when not authenticated; an actual error → log
      console.error('player_completions read error', error);
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data) out.add(row.puzzle_code);
    if (data.length < PAGE) break;
  }
  _cache = out;
  _cachedAt = now;
  return out;
}

export async function getCompletionCount(): Promise<number> {
  const client = await ensureAuthClient();
  if (!client) return 0;
  const { data, error } = await client.rpc('get_completion_count');
  if (error || typeof data !== 'number') return 0;
  return data;
}

export interface SinglePlayerCompletionInput {
  code: PuzzleCode;
  solveTimeMs?: number;
  daily?: {
    date: string;
    difficulty: 'easy' | 'medium' | 'hard';
  };
}

/** Record a single-player completion. Idempotent for the ever-solved row and daily row. */
export async function recordSinglePlayerCompletion(
  input: PuzzleCode | SinglePlayerCompletionInput,
): Promise<void> {
  const client = await ensureAuthClient();
  if (!client) return;
  const payload = typeof input === 'string' ? { code: input } : input;
  const { error } = await client.rpc('record_single_player_completion', {
    p_code: payload.code,
    p_solve_time_ms: payload.solveTimeMs ?? null,
    p_daily_date: payload.daily?.date ?? null,
    p_daily_difficulty: payload.daily?.difficulty ?? null,
  });
  if (error) {
    console.error('record_single_player_completion error', error);
    return;
  }
  invalidateCompletionsCache();
}
