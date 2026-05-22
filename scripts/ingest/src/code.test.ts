import { describe, expect, it } from 'vitest';
import { puzzleCodeFor } from './code';

/**
 * These tests pin the puzzle-code algorithm. If they break, either:
 *  (a) the migration 0003 function diverged from the TS implementation, or
 *  (b) someone changed the hash on purpose.
 *
 * Don't update the pinned values unless you've also written a new migration
 * that re-hashes every existing row.
 */

const EMPTY = Array<number>(81).fill(0);

// Known sample puzzles from apps/web/lib/sample-puzzles.ts. Codes computed by
// the Postgres function and verified against the live Supabase ingest. If you
// change the algorithm, update these values too.
const FIXTURES: Array<{ name: string; givens: number[]; code: string }> = [
  {
    name: 'all zeros (empty board)',
    givens: EMPTY,
    code: 'd0wnhx',
  },
  {
    name: 'pattern (i*13)%10',
    givens: Array.from({ length: 81 }, (_, i) => (i * 13) % 10),
    code: 'is173u',
  },
];

describe('puzzleCodeFor', () => {
  it.each(FIXTURES)('matches the pinned code for $name', ({ givens, code }) => {
    expect(puzzleCodeFor(givens)).toBe(code);
  });

  it('always returns 6 lowercase base36 characters', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const givens = Array.from({ length: 81 }, () => Math.floor(Math.random() * 10));
      const code = puzzleCodeFor(givens);
      expect(code).toMatch(/^[0-9a-z]{6}$/);
      seen.add(code);
    }
    // Sanity: at least some variety.
    expect(seen.size).toBeGreaterThan(150);
  });

  it('is deterministic', () => {
    const givens = Array.from({ length: 81 }, (_, i) => (i * 13) % 10);
    expect(puzzleCodeFor(givens)).toBe(puzzleCodeFor(givens));
  });

  it('throws on wrong length', () => {
    expect(() => puzzleCodeFor([1, 2, 3])).toThrow();
  });
});
