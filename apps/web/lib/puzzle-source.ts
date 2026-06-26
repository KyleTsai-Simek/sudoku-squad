'use client';

import type { Difficulty, PuzzleCode } from '@sudoku-squad/core';
import { getSupabase } from './supabase';
import { SAMPLE_PUZZLES, getSamplePuzzleByCode } from './sample-puzzles';

/**
 * The single-player puzzle shape. Includes the solution because hint and
 * completion check happen client-side in SP — there's no other player to
 * cheat against. Multiplayer (Phase 2+) does NOT see this shape: it'll fetch
 * givens only and go through an Edge Function for hint/check. See
 * docs/DECISIONS.md #0022.
 */
export interface FetchedPuzzle {
  code: PuzzleCode;
  difficulty: Difficulty;
  givens: number[];
  solution: number[];
  daily?: {
    date: string;
    difficulty: 'easy' | 'medium' | 'hard';
  };
}

/** Public-view row, no solution. Used for browsing/listing. */
export interface PuzzleSummary {
  code: PuzzleCode;
  difficulty: Difficulty;
}

/**
 * Bundled-pack fallback used when the Supabase client isn't available — i.e.
 * the Playwright smoke (no env in CI) or an offline dev workspace. Production
 * always goes through Supabase. The fallback is intentionally minimal (5
 * puzzles, lowercase base36 codes computed by the same algorithm).
 */
function bundledSummaries(): PuzzleSummary[] {
  return SAMPLE_PUZZLES.map((p) => ({ code: p.code, difficulty: p.difficulty }));
}

/** Load a puzzle by its short code. Bundled samples short-circuit before
 *  the RPC so the smoke test runs without Supabase. */
export async function loadPuzzle(code: PuzzleCode): Promise<FetchedPuzzle | null> {
  const sample = getSamplePuzzleByCode(code);
  if (sample) return sample;

  const client = getSupabase();
  if (!client) return null;
  const { data, error } = await client.rpc('sp_get_puzzle', { p_code: code });
  if (error) {
    console.error('sp_get_puzzle error', error);
    return null;
  }
  const row = data?.[0];
  if (!row) return null;
  return {
    code: row.code,
    difficulty: row.difficulty as Difficulty,
    givens: row.givens,
    solution: row.solution,
  };
}

/**
 * List every puzzle's (code, difficulty). 15,000 rows of small objects ≈ 30 KB —
 * fine to fetch once at home-page load. Returns the bundled pack when Supabase
 * isn't configured.
 */
export async function listPuzzles(): Promise<PuzzleSummary[]> {
  const client = getSupabase();
  if (!client) return bundledSummaries();

  const out: PuzzleSummary[] = [];
  const PAGE = 1000; // PostgREST default row limit.
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client
      .from('puzzles_public')
      .select('code, difficulty')
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error('listPuzzles error', error);
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      out.push({ code: row.code, difficulty: row.difficulty as Difficulty });
    }
    if (data.length < PAGE) break;
  }
  return out;
}
