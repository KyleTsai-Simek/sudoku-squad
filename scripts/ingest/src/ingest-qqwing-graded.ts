/**
 * Generate the four upper tiers (`medium`, `hard`, `expert`, `killer`) locally
 * via QQWing, graded by QQWing's own difficulty classification + technique
 * counts rather than the (now-retired) Kaggle rating bands. See
 * docs/DECISIONS.md #0042.
 *
 * Tier mapping:
 *   QQWing EASY                                          -> medium
 *   QQWing INTERMEDIATE, 1 advanced technique  (guess=0) -> hard
 *   QQWing INTERMEDIATE, >=2 advanced techniques (guess=0)-> expert
 *   QQWing EXPERT                              (guess>=1) -> killer (hidden)
 *
 * "Advanced techniques" = the four non-single solving techniques QQWing tracks:
 * naked pair, hidden pair, pointing pair/triple, box-line reduction. QQWing's
 * INTERMEDIATE class is exactly "needs >=1 of these, but no guessing"; we split
 * it into hard (needs one) and expert (needs to chain two or more), so expert
 * stays fully pure-logic (guess_count = 0). EXPERT is QQWing's "requires a
 * guess" class and backs the hidden killer tier.
 *
 * SIMPLE generations are discarded (they belong to warmup/easy, produced by
 * ingest-qqwing.ts). There is NO clue-count augmentation: augmentation only
 * eases a puzzle, which would destroy the technique requirement that defines
 * these tiers. We take QQWing's minimal output as-is.
 *
 * Each kept puzzle keeps the existing quality gates: unique solution (Norvig
 * solver), solution matches QQWing's, deduped by puzzle code. We also store
 * QQWing's per-puzzle metadata (difficulty label, clue count, guess/backtrack
 * counts, per-technique counts, and the derived advanced-technique-type count).
 *
 * Run:
 *   pnpm --filter @sudoku-squad/ingest ingest:qqwing-graded
 *   pnpm --filter @sudoku-squad/ingest ingest:qqwing-graded --dry-run
 *   pnpm --filter @sudoku-squad/ingest ingest:qqwing-graded --count 50   (50 per tier, small test)
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
// @ts-expect-error — qqwing has no types
import QQWing from 'qqwing';
import { puzzleCodeFor } from './code';
import { hasUniqueSolution, solve } from './solver';

// qqwing.Difficulty enum values.
const QQ_SIMPLE = 1;
const QQ_EASY = 2;
const QQ_INTERMEDIATE = 3;
const QQ_EXPERT = 4;

type GradedTier = 'medium' | 'hard' | 'expert' | 'killer';
const TIERS: GradedTier[] = ['medium', 'hard', 'expert', 'killer'];

const DEFAULT_PER_TIER = 2500;

interface Args {
  dryRun: boolean;
  perTier: number;
}

function parseArgs(): Args {
  const dryRun = process.argv.includes('--dry-run');
  const countIdx = process.argv.indexOf('--count');
  const perTier = countIdx >= 0 ? Number(process.argv[countIdx + 1]) : DEFAULT_PER_TIER;
  if (!Number.isFinite(perTier) || perTier <= 0) {
    throw new Error(`Bad --count: ${process.argv[countIdx + 1]}`);
  }
  return { dryRun, perTier };
}

/** QQWing's per-puzzle solving metadata. Stored as typed columns on the row. */
interface PuzzleMeta {
  qqwing_difficulty: string; // 'easy' | 'intermediate' | 'expert'
  clue_count: number;
  guess_count: number;
  backtrack_count: number;
  single_count: number;
  hidden_single_count: number;
  naked_pair_count: number;
  hidden_pair_count: number;
  pointing_pair_triple_count: number;
  box_line_reduction_count: number;
  advanced_technique_count: number; // distinct advanced techniques used (0-4)
}

interface Generated {
  puzzle: number[];
  solution: number[];
  qqDifficulty: number;
  meta: PuzzleMeta;
}

function strToBoard(s: string): number[] {
  // QQWing emits a pretty-printed grid; '.' is empty, '1'..'9' a digit, and any
  // separator (space, |, -, newline) is skipped.
  const out: number[] = [];
  for (const ch of s) {
    if (ch === '.') out.push(0);
    else if (ch >= '1' && ch <= '9') out.push(Number(ch));
  }
  if (out.length !== 81) {
    throw new Error(`bad qqwing output length ${out.length} (expected 81)`);
  }
  return out;
}

function generateOne(): Generated {
  const q = new QQWing();
  q.generatePuzzle();
  q.setRecordHistory(true);
  q.solve();
  const nakedPair = q.getNakedPairCount();
  const hiddenPair = q.getHiddenPairCount();
  const pointing = q.getPointingPairTripleCount();
  const boxLine = q.getBoxLineReductionCount();
  const advanced = [nakedPair, hiddenPair, pointing, boxLine].filter((n) => n > 0).length;
  return {
    puzzle: strToBoard(q.getPuzzleString()),
    solution: strToBoard(q.getSolutionString()),
    qqDifficulty: q.getDifficulty(),
    meta: {
      qqwing_difficulty: String(q.getDifficultyAsString()).toLowerCase(),
      clue_count: q.getGivenCount(),
      guess_count: q.getGuessCount(),
      backtrack_count: q.getBacktrackCount(),
      single_count: q.getSingleCount(),
      hidden_single_count: q.getHiddenSingleCount(),
      naked_pair_count: nakedPair,
      hidden_pair_count: hiddenPair,
      pointing_pair_triple_count: pointing,
      box_line_reduction_count: boxLine,
      advanced_technique_count: advanced,
    },
  };
}

/** Map a generated puzzle to its tier, or null to discard. */
function classify(gen: Generated): GradedTier | null {
  switch (gen.qqDifficulty) {
    case QQ_EASY:
      return 'medium';
    case QQ_INTERMEDIATE:
      // All intermediate puzzles are pure-logic (guess_count == 0). Split by
      // how many distinct advanced techniques the solve required.
      return gen.meta.advanced_technique_count >= 2 ? 'expert' : 'hard';
    case QQ_EXPERT:
      // QQWing EXPERT == requires guessing. Guard the invariant anyway.
      return gen.meta.guess_count >= 1 ? 'killer' : null;
    default:
      return null; // SIMPLE / UNKNOWN
  }
}

interface Row extends PuzzleMeta {
  difficulty: GradedTier;
  code: string;
  givens: number[];
  solution: number[];
}

async function main(): Promise<void> {
  const args = parseArgs();
  const overallTarget = args.perTier * TIERS.length;
  console.log(
    `Generating QQWing-graded puzzles: ${args.perTier} each of\n` +
      `  medium(EASY) / hard(INTERMEDIATE,1 tech) / expert(INTERMEDIATE,>=2 tech) / killer(EXPERT,guess>=1)\n` +
      `  = ${overallTarget} total.`,
  );

  const admin = args.dryRun
    ? null
    : (() => {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
        return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
      })();

  const kept: Record<GradedTier, Row[]> = { medium: [], hard: [], expert: [], killer: [] };
  const seenCodes = new Set<string>();
  const rejects = { discarded: 0, tierFull: 0, nonUnique: 0, solutionMismatch: 0, duplicate: 0 };
  let attempts = 0;
  const t0 = Date.now();
  let progressTick = 0;

  const totalKept = (): number => TIERS.reduce((n, t) => n + kept[t].length, 0);
  const allFull = (): boolean => TIERS.every((t) => kept[t].length >= args.perTier);

  while (!allFull()) {
    attempts++;
    const gen = generateOne();
    const tier = classify(gen);
    if (!tier) {
      rejects.discarded++;
      continue;
    }
    if (kept[tier].length >= args.perTier) {
      rejects.tierFull++;
      continue;
    }

    // Existing quality gates: unique solution, solution matches, dedupe.
    if (!hasUniqueSolution(gen.puzzle)) {
      rejects.nonUnique++;
      continue;
    }
    const solved = solve(gen.puzzle);
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
      rejects.solutionMismatch++;
      continue;
    }
    const code = puzzleCodeFor(gen.puzzle);
    if (seenCodes.has(code)) {
      rejects.duplicate++;
      continue;
    }
    seenCodes.add(code);

    kept[tier].push({ difficulty: tier, code, givens: gen.puzzle, solution: solved, ...gen.meta });

    if (totalKept() - progressTick >= 250) {
      progressTick = totalKept();
      const elapsed = (Date.now() - t0) / 1000;
      const rate = totalKept() / elapsed;
      const eta = rate > 0 ? (overallTarget - totalKept()) / rate : 0;
      console.log(
        `  kept ${totalKept()}/${overallTarget} ` +
          `[m=${kept.medium.length} h=${kept.hard.length} e=${kept.expert.length} k=${kept.killer.length}] ` +
          `attempts=${attempts}  ${rate.toFixed(1)} kept/sec  eta=${eta.toFixed(0)}s`,
      );
    }
  }

  const elapsed = (Date.now() - t0) / 1000;
  console.log(`\nKept ${totalKept()} in ${elapsed.toFixed(0)}s from ${attempts} generations.`);
  console.log(
    `Rejects — discarded(simple/unknown)=${rejects.discarded} tierFull=${rejects.tierFull} ` +
      `nonUnique=${rejects.nonUnique} solutionMismatch=${rejects.solutionMismatch} duplicate=${rejects.duplicate}`,
  );

  console.log('\nPer-tier summary (natural QQWing output, no augmentation):');
  for (const tier of TIERS) {
    const rows = kept[tier];
    if (rows.length === 0) {
      console.log(`  ${tier.padEnd(7)} n=0`);
      continue;
    }
    const clues = rows.map((r) => r.clue_count);
    const clueMin = Math.min(...clues);
    const clueMax = Math.max(...clues);
    const clueAvg = clues.reduce((a, b) => a + b, 0) / rows.length;
    const needGuess = rows.filter((r) => r.guess_count > 0).length;
    const advAvg = rows.reduce((a, r) => a + r.advanced_technique_count, 0) / rows.length;
    console.log(
      `  ${tier.padEnd(7)} n=${rows.length}  clues ${clueMin}-${clueMax} (avg ${clueAvg.toFixed(1)})  ` +
        `adv-techniques avg ${advAvg.toFixed(2)}  needs-guessing ${needGuess}`,
    );
  }

  if (!admin) {
    console.log('\nDry-run: skipping Supabase insert.');
    return;
  }

  const rows: Row[] = TIERS.flatMap((t) => kept[t]);
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
