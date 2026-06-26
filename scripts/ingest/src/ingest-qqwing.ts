/**
 * Generate the two easiest sudoku tiers via QQWing. These are naked-singles-only
 * puzzles with negative ratings in [-10, 0). See docs/DECISIONS.md #0033/#0047.
 *
 * Pipeline:
 *   1. Generate a puzzle via QQWing.
 *   2. Filter to SIMPLE (naked-singles-only) — discards ~97% of generations.
 *   3. Pick a target clue count (drawn from a per-tier distribution).
 *   4. Augment by adding random solution cells to reach that target. Adding
 *      correct givens can't make a puzzle harder, so the result stays SIMPLE
 *      by construction; we re-verify anyway to be paranoid.
 *   5. Assign rating = -((clues - 28) / 12) * 10, clamped to [-10, 0). Tier:
 *      rating < -5 → easy, else → medium.
 *   6. Solver-verify uniqueness (mirroring the radcliffe ingest) and insert.
 *
 * Run:
 *   pnpm --filter @sudoku-squad/ingest ingest:qqwing
 *   pnpm --filter @sudoku-squad/ingest ingest:qqwing --dry-run
 *   pnpm --filter @sudoku-squad/ingest ingest:qqwing --count 100   (small test)
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
// @ts-expect-error — qqwing has no types
import QQWing from 'qqwing';
import { puzzleCodeFor } from './code';
import { hasUniqueSolution, solve } from './solver';

const SIMPLE = 1; // qqwing.Difficulty.SIMPLE

/** Tiers produced by the QQWing ingest after the #0047 label shift. */
type QqwingTier = 'easy' | 'medium';

interface Args {
  dryRun: boolean;
  count: number;
}

function parseArgs(): Args {
  const dryRun = process.argv.includes('--dry-run');
  const countIdx = process.argv.indexOf('--count');
  const count = countIdx >= 0 ? Number(process.argv[countIdx + 1]) : 5000;
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error(`Bad --count: ${process.argv[countIdx + 1]}`);
  }
  return { dryRun, count };
}

// Per-(tier, clues) targets. Sums to 2,500 per tier (5,000 total). Tier
// boundaries follow rating = -((clues - 28) / 12) * 10: clues 35-40 → easy,
// clues 29-34 → medium. Within each tier the bias keeps the per-clue-count
// shape monotonic — easy leans toward 38-40 (almost-done puzzles), medium
// leans toward 29-30 (still gentle, but with some hunting).
const TARGET_PER_CELL: Record<QqwingTier, Record<number, number>> = {
  easy: { 35: 100, 36: 200, 37: 300, 38: 500, 39: 700, 40: 700 }, // sum 2500
  medium: { 29: 700, 30: 700, 31: 400, 32: 300, 33: 250, 34: 150 }, // sum 2500
};

function tierTotal(tier: QqwingTier): number {
  return Object.values(TARGET_PER_CELL[tier]).reduce((a, b) => a + b, 0);
}

interface QqwingResult {
  puzzle: number[];   // 81-int, 0=empty
  solution: number[];
  difficulty: number;
  givens: number;
}

function strToBoard(s: string): number[] {
  // QQWing's getPuzzleString() emits a pretty-printed grid with " . " for empty
  // cells and the digit for filled ones, separated by spaces / "|" / "-" /
  // newlines. We treat "." as 0 and "1".."9" as the digit; everything else is
  // a separator.
  const out: number[] = [];
  for (const ch of s) {
    if (ch === '.') {
      out.push(0);
    } else if (ch >= '1' && ch <= '9') {
      out.push(Number(ch));
    }
    // anything else (space, |, -, newline) skipped
  }
  if (out.length !== 81) {
    throw new Error(`bad qqwing output length ${out.length} (expected 81)`);
  }
  return out;
}

function generateOne(): QqwingResult | null {
  const q = new QQWing();
  q.generatePuzzle();
  q.setRecordHistory(true);
  q.solve();
  if (q.getDifficulty() !== SIMPLE) return null;
  return {
    puzzle: strToBoard(q.getPuzzleString()),
    solution: strToBoard(q.getSolutionString()),
    difficulty: q.getDifficulty(),
    givens: q.getGivenCount(),
  };
}

function augmentToClueCount(givens: number[], solution: number[], target: number): number[] {
  if (target <= givens.filter((v) => v !== 0).length) return givens.slice();
  const out = givens.slice();
  const empties: number[] = [];
  for (let i = 0; i < 81; i++) if (out[i] === 0) empties.push(i);
  for (let i = empties.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [empties[i]!, empties[j]!] = [empties[j]!, empties[i]!];
  }
  const need = target - givens.filter((v) => v !== 0).length;
  for (let i = 0; i < need && i < empties.length; i++) {
    out[empties[i]!] = solution[empties[i]!]!;
  }
  return out;
}

function verifyStillSimple(givens: number[]): boolean {
  const q = new QQWing();
  // Re-import the puzzle as a flat 81-int array.
  q.setPuzzle(givens.slice());
  q.setRecordHistory(true);
  q.solve();
  return q.getDifficulty() === SIMPLE;
}

interface CellState {
  filled: number;
  target: number;
}

function buildCounters(): Record<QqwingTier, Map<number, CellState>> {
  return {
    easy: new Map(Object.entries(TARGET_PER_CELL.easy).map(([c, t]) => [Number(c), { filled: 0, target: t }])),
    medium: new Map(Object.entries(TARGET_PER_CELL.medium).map(([c, t]) => [Number(c), { filled: 0, target: t }])),
  };
}

/** Pick a (tier, clues) cell that still has remaining target, weighted by
 *  remaining capacity. Returns null when every cell is full. */
function pickCell(counters: Record<QqwingTier, Map<number, CellState>>):
  | { tier: QqwingTier; clues: number }
  | null {
  const open: Array<{ tier: QqwingTier; clues: number; remaining: number }> = [];
  let total = 0;
  for (const tier of ['easy', 'medium'] as const) {
    for (const [c, s] of counters[tier]) {
      const remaining = s.target - s.filled;
      if (remaining > 0) {
        open.push({ tier, clues: c, remaining });
        total += remaining;
      }
    }
  }
  if (open.length === 0) return null;
  let r = Math.random() * total;
  for (const o of open) {
    r -= o.remaining;
    if (r < 0) return { tier: o.tier, clues: o.clues };
  }
  return { tier: open[0]!.tier, clues: open[0]!.clues };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const overallTarget = args.count > 0 && args.count !== 5000 ? args.count : tierTotal('easy') + tierTotal('medium');
  console.log(`Generating naked-singles-only puzzles via QQWing (target ${overallTarget}) ...`);
  console.log('Per-cell targets:');
  for (const tier of ['easy', 'medium'] as const) {
    const parts = Object.entries(TARGET_PER_CELL[tier]).map(([c, n]) => `${c}c=${n}`).join(' ');
    console.log(`  ${tier.padEnd(9)} ${parts}  (sum ${tierTotal(tier)})`);
  }

  const admin = args.dryRun
    ? null
    : (() => {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
        return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
      })();

  const counters = buildCounters();
  const rows: Array<{
    difficulty: QqwingTier;
    code: string;
    givens: number[];
    solution: number[];
  }> = [];
  const seenCodes = new Set<string>();
  const rejects = { notSimple: 0, augmentBroke: 0, nonUnique: 0, duplicate: 0 };
  let attempts = 0;
  const t0 = Date.now();

  // Heads-up so we don't print past `overallTarget` (--count override).
  let progressTick = 0;

  while (true) {
    const cell = pickCell(counters);
    if (!cell) break;
    if (rows.length >= overallTarget) break;
    attempts++;
    const gen = generateOne();
    if (!gen) {
      rejects.notSimple++;
      continue;
    }
    const augmented = augmentToClueCount(gen.puzzle, gen.solution, cell.clues);
    if (!verifyStillSimple(augmented)) {
      rejects.augmentBroke++;
      continue;
    }
    if (!hasUniqueSolution(augmented)) {
      rejects.nonUnique++;
      continue;
    }
    const solved = solve(augmented);
    if (!solved) {
      rejects.nonUnique++;
      continue;
    }
    let matches = true;
    for (let i = 0; i < 81; i++) {
      if (solved[i] !== gen.solution[i]) {
        matches = false;
        break;
      }
    }
    if (!matches) {
      rejects.nonUnique++;
      continue;
    }
    const code = puzzleCodeFor(augmented);
    if (seenCodes.has(code)) {
      rejects.duplicate++;
      continue;
    }
    seenCodes.add(code);
    const actualClues = augmented.filter((v) => v !== 0).length;
    // Sanity: actualClues should equal cell.clues (augment always hits the
    // exact target). If not, log + skip.
    if (actualClues !== cell.clues) {
      console.warn(`augment overshoot: wanted ${cell.clues}, got ${actualClues}`);
      continue;
    }
    rows.push({ difficulty: cell.tier, code, givens: augmented, solution: solved });
    counters[cell.tier].get(cell.clues)!.filled++;

    if (rows.length - progressTick >= 100) {
      progressTick = rows.length;
      const elapsed = (Date.now() - t0) / 1000;
      const rate = rows.length / elapsed;
      const eta = rate > 0 ? (overallTarget - rows.length) / rate : 0;
      console.log(
        `  ${rows.length}/${overallTarget}  attempts=${attempts}  ${rate.toFixed(1)} kept/sec  eta=${eta.toFixed(0)}s`,
      );
    }
  }

  const elapsed = (Date.now() - t0) / 1000;
  console.log(`\nKept ${rows.length} in ${elapsed.toFixed(0)}s from ${attempts} attempts.`);
  console.log(
    `Rejects — notSimple=${rejects.notSimple} augmentBroke=${rejects.augmentBroke} nonUnique=${rejects.nonUnique} duplicate=${rejects.duplicate}`,
  );

  const byTier = new Map<string, number>();
  for (const r of rows) byTier.set(r.difficulty, (byTier.get(r.difficulty) ?? 0) + 1);
  console.log('\nPer-tier sample counts:');
  for (const [t, n] of byTier) console.log(`  ${t.padEnd(9)} ${n}`);

  // Clue-count distribution per tier
  const clueHist = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const c = r.givens.filter((v) => v !== 0).length;
    const m = clueHist.get(r.difficulty) ?? new Map<number, number>();
    m.set(c, (m.get(c) ?? 0) + 1);
    clueHist.set(r.difficulty, m);
  }
  console.log('\nClue-count distribution:');
  for (const [t, m] of clueHist) {
    const parts = [...m.entries()].sort(([a], [b]) => a - b).map(([c, n]) => `${c}c=${n}`).join(' ');
    console.log(`  ${t.padEnd(9)} ${parts}`);
  }

  if (!admin) {
    console.log('\nDry-run: skipping Supabase insert.');
    return;
  }

  console.log(`\nInserting ${rows.length} puzzles into Supabase in batches of 500…`);
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await admin.from('puzzles').insert(batch);
    if (error) {
      console.error(`Batch ${i}-${i + batch.length} failed: ${error.message}`);
      throw error;
    }
    process.stdout.write(`  inserted ${Math.min(i + 500, rows.length)}/${rows.length}\r`);
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
