import { createHash } from 'node:crypto';

/**
 * 6-char lowercase base36 hash of an 81-int givens array.
 *
 * Mirrors `public.puzzle_code_for(smallint[])` in
 * supabase/migrations/0003_puzzle_code_and_sp_rpc.sql. If you change one,
 * change the other and re-run the unit test that pins the algorithm.
 *
 *   code = base36( first 40 bits of md5(concat(givens)) mod 36^6 ) padded to 6
 *
 * `concat(givens)` is the 81-char string of digits, same as Postgres'
 * `array_to_string(givens, '')` (each cell is 0..9, single character).
 */
export function puzzleCodeFor(givens: ReadonlyArray<number>): string {
  if (givens.length !== 81) {
    throw new Error(`Expected 81 cells, got ${givens.length}`);
  }
  const text = givens.join('');
  const hex = createHash('md5').update(text).digest('hex'); // 32 hex chars
  // First 10 hex chars = 40 bits → always a positive bigint < 2^40.
  let n = BigInt('0x' + hex.slice(0, 10));
  const M = 36n ** 6n; // 2,176,782,336
  n = n % M;
  // Encode to base36, lowercase, padded to 6.
  return n.toString(36).padStart(6, '0');
}
