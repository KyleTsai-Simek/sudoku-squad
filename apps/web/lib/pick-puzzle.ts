'use client';

import type { Difficulty } from '@sudoku-squad/core';
import { listPuzzles, type PuzzleSummary } from './puzzle-source';
import { getCompletedSet } from './completions';

let cache: Promise<PuzzleSummary[]> | null = null;

function getManifest(): Promise<PuzzleSummary[]> {
  if (!cache) cache = listPuzzles();
  return cache;
}

/**
 * Pick a random puzzle code in the given difficulty that the player hasn't
 * solved yet. If every puzzle of that tier has been solved, falls back to
 * any puzzle of that tier (so the menu never goes empty).
 *
 * Returns null only when the catalog has no puzzles of that difficulty at
 * all (e.g. expert tier is currently empty).
 */
export async function pickRandomUnsolved(
  difficulty: Difficulty,
): Promise<string | null> {
  const all = await getManifest();
  const solved = await getCompletedSet();

  const ofTier = all.filter((p) => p.difficulty === difficulty);
  if (ofTier.length === 0) return null;

  const unsolved = ofTier.filter((p) => !solved.has(p.code));
  const pool = unsolved.length > 0 ? unsolved : ofTier;
  return pool[Math.floor(Math.random() * pool.length)]!.code;
}

/**
 * Counts per tier: total + unsolved. Used by the home page to show
 * progress and disable empty tiers.
 */
export async function getTierCounts(): Promise<
  Record<Difficulty, { total: number; unsolved: number }>
> {
  const all = await getManifest();
  const solved = await getCompletedSet();
  const out: Record<Difficulty, { total: number; unsolved: number }> = {
    warmup: { total: 0, unsolved: 0 },
    easy: { total: 0, unsolved: 0 },
    medium: { total: 0, unsolved: 0 },
    hard: { total: 0, unsolved: 0 },
    expert: { total: 0, unsolved: 0 },
    killer: { total: 0, unsolved: 0 },
  };
  for (const p of all) {
    const t = out[p.difficulty];
    if (!t) continue;
    t.total++;
    if (!solved.has(p.code)) t.unsolved++;
  }
  return out;
}
