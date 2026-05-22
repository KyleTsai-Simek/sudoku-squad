'use client';

import type { Difficulty } from '@sudoku-squad/core';
import { getSupabase, hasSupabase } from './supabase';
import { SAMPLE_PUZZLES, getSamplePuzzleByCode, type SamplePuzzle } from './sample-puzzles';

/**
 * The single-player puzzle. Includes the solution because hint and
 * completion check happen client-side in SP — there's no other player to
 * cheat against. Multiplayer (Phase 2+) will not see this shape: it'll
 * fetch givens only and go through an Edge Function for hint/check.
 */
export interface FetchedPuzzle {
  code: string;
  difficulty: Difficulty;
  givens: number[];
  solution: number[];
}

/** Public-view row, no solution. Used for browsing/listing. */
export interface PuzzleSummary {
  code: string;
  difficulty: Difficulty;
}

/**
 * Load a puzzle by its short code. Tries the bundled fallback first (so the
 * smoke test and offline dev work without Supabase), then the live RPC.
 */
export async function loadPuzzle(code: string): Promise<FetchedPuzzle | null> {
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
 * List every puzzle's (code, difficulty). Returns the bundled pack when
 * Supabase isn't configured. The full Supabase list is ~7500 rows of small
 * objects (~15 KB) — fine to fetch once at home-page load.
 */
export async function listPuzzles(): Promise<PuzzleSummary[]> {
  if (!hasSupabase()) {
    return SAMPLE_PUZZLES.map((p) => ({ code: p.code, difficulty: p.difficulty }));
  }
  const client = getSupabase();
  if (!client) {
    return SAMPLE_PUZZLES.map((p) => ({ code: p.code, difficulty: p.difficulty }));
  }
  // Page through PostgREST's default 1000-row limit.
  const out: PuzzleSummary[] = [];
  const PAGE = 1000;
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
