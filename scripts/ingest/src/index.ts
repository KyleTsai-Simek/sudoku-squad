/**
 * Ingestion entrypoint.
 *
 * Reads a Kaggle sudoku CSV (default: the 1M dataset), buckets puzzles into
 * easy/medium/hard/expert by clue count (or by a `difficulty` column if the
 * CSV has one), solver-verifies each candidate row for unique solution and
 * matching solution, and upserts a balanced sample into Supabase.
 *
 * Run: `pnpm --filter @sudoku-squad/ingest ingest`
 *
 * Env (loaded from repo root `.env.local`):
 *  - NEXT_PUBLIC_SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY  (NEVER use the anon key here)
 *
 * Targets per tier and CSV path are configurable below.
 */

import 'dotenv/config';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { readCsvRows } from './csv';
import { puzzleCodeFor } from './code';
import { hasUniqueSolution, solve } from './solver';

type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

const TIERS: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
// V1 ingest is easy/medium/hard only. The 3M dataset has very few rows rated
// >7.0 (~100 of 3M), so an "expert" tier samples poorly today. The raw rows
// remain in scripts/ingest/data/sudoku-3m.csv — bump this back to 2500 (or
// lower) once we have a richer high-difficulty source. See STATUS.md.
const TARGET_PER_TIER: Record<Difficulty, number> = {
  easy: 2500,
  medium: 2500,
  hard: 2500,
  expert: 0,
};
const BATCH_SIZE = 250;
const PROGRESS_EVERY = 5000;

const DATA_DIR = resolve(import.meta.dirname, '../data');

interface CandidateRow {
  puzzle: string;
  solution: string;
}

interface SampledPuzzle {
  difficulty: Difficulty;
  code: string;
  givens: number[];
  solution: number[];
}

function findCsv(explicit?: string): string {
  if (explicit) {
    const p = resolve(process.cwd(), explicit);
    if (!existsSync(p)) throw new Error(`CSV not found: ${p}`);
    return p;
  }
  if (!existsSync(DATA_DIR)) {
    throw new Error(
      `Data directory not found: ${DATA_DIR}\n` +
        `Create it and drop the Kaggle CSV in — see scripts/ingest/README.md for download instructions.`,
    );
  }
  const candidates = readdirSync(DATA_DIR)
    .filter((f) => f.toLowerCase().endsWith('.csv'))
    .map((f) => resolve(DATA_DIR, f))
    .sort((a, b) => statSync(b).size - statSync(a).size);
  const first = candidates[0];
  if (!first) {
    throw new Error(
      `No .csv file found in ${DATA_DIR}. See scripts/ingest/README.md.`,
    );
  }
  return first;
}

function parseFlag(name: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function strToBoard(s: string): number[] {
  if (s.length !== 81) {
    throw new Error(`Expected 81-char board, got ${s.length}: ${s.slice(0, 20)}…`);
  }
  const out: number[] = new Array(81);
  for (let i = 0; i < 81; i++) {
    const ch = s[i]!;
    if (ch === '.' || ch === '0') out[i] = 0;
    else {
      const n = ch.charCodeAt(0) - 48;
      if (n < 1 || n > 9) throw new Error(`Bad char at ${i}: ${ch}`);
      out[i] = n;
    }
  }
  return out;
}

function countClues(givens: ReadonlyArray<number>): number {
  let n = 0;
  for (const v of givens) if (v !== 0) n++;
  return n;
}

/**
 * Difficulty by clue count is the standard heuristic when the dataset lacks
 * a rating column. Bands are conservative and match how most public packs
 * (and the Norvig writeup) describe difficulty.
 */
function difficultyFromClues(clues: number): Difficulty {
  if (clues >= 36) return 'easy';
  if (clues >= 30) return 'medium';
  if (clues >= 26) return 'hard';
  return 'expert';
}

/** Map a free-form difficulty label from the dataset to one of our four tiers. */
function normalizeDifficulty(label: string): Difficulty | null {
  const v = label.trim().toLowerCase();
  if (!v) return null;
  if (v === 'easy' || v === 'simple' || v === '1') return 'easy';
  if (v === 'medium' || v === 'moderate' || v === '2') return 'medium';
  if (v === 'hard' || v === 'difficult' || v === '3') return 'hard';
  if (v === 'expert' || v === 'evil' || v === 'insane' || v === '4') return 'expert';
  // Numeric rating: heuristic split.
  const n = Number(v);
  if (Number.isFinite(n)) {
    if (n <= 2.5) return 'easy';
    if (n <= 5) return 'medium';
    if (n <= 7) return 'hard';
    return 'expert';
  }
  return null;
}

function pickColumns(row: Record<string, string>): CandidateRow | null {
  // Common header variants across the Kaggle datasets we care about.
  const puzzle =
    row['puzzle'] ?? row['quizzes'] ?? row['quiz'] ?? row['puzzles'] ?? null;
  const solution =
    row['solution'] ?? row['solutions'] ?? row['answer'] ?? null;
  if (!puzzle || !solution) return null;
  return { puzzle, solution };
}

function difficultyForRow(
  row: Record<string, string>,
  clues: number,
): Difficulty {
  const label =
    row['difficulty'] ??
    row['level'] ??
    row['rating'] ??
    row['difficulty_rating'] ??
    null;
  if (label) {
    const norm = normalizeDifficulty(label);
    if (norm) return norm;
  }
  return difficultyFromClues(clues);
}

function tiersFull(buckets: Record<Difficulty, SampledPuzzle[]>): boolean {
  for (const t of TIERS) {
    if (buckets[t].length < TARGET_PER_TIER[t]) return false;
  }
  return true;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dryRun && (!url || !serviceKey)) {
    throw new Error(
      'Missing env vars. Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local. (Use --dry-run to skip Supabase.)',
    );
  }

  const explicitCsv = parseFlag('--csv');
  const path = findCsv(explicitCsv);
  console.log(`Reading ${path}`);
  console.log(
    `Target per tier: ${TIERS.map((t) => `${t}=${TARGET_PER_TIER[t]}`).join(', ')}`,
  );

  const admin = dryRun
    ? null
    : createClient(url!, serviceKey!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

  if (admin) {
    const { count: existing, error: countErr } = await admin
      .from('puzzles')
      .select('*', { count: 'exact', head: true });
    if (countErr) throw countErr;
    console.log(`Existing puzzles row count: ${existing ?? 0}`);
    if ((existing ?? 0) > 0) {
      console.log(
        'Note: appending to existing rows. Truncate manually if you want a clean slate.',
      );
    }
  } else {
    console.log('Dry-run mode: Supabase writes disabled.');
  }

  const buckets: Record<Difficulty, SampledPuzzle[]> = {
    easy: [],
    medium: [],
    hard: [],
    expert: [],
  };
  const rejects = { parse: 0, nonUnique: 0, mismatch: 0 };
  let scanned = 0;

  for await (const row of readCsvRows(path)) {
    scanned++;
    if (scanned % PROGRESS_EVERY === 0) {
      const totals = TIERS.map((t) => `${t}=${buckets[t].length}`).join(' ');
      console.log(`  scanned=${scanned}  ${totals}`);
    }

    const picked = pickColumns(row);
    if (!picked) {
      rejects.parse++;
      continue;
    }

    let givens: number[];
    let claimed: number[];
    try {
      givens = strToBoard(picked.puzzle);
      claimed = strToBoard(picked.solution);
    } catch {
      rejects.parse++;
      continue;
    }

    const tier = difficultyForRow(row, countClues(givens));
    if (buckets[tier].length >= TARGET_PER_TIER[tier]) continue;

    // Verify uniqueness — this is the load-bearing check per DECISIONS.md #0011/#0012.
    if (!hasUniqueSolution(givens)) {
      rejects.nonUnique++;
      continue;
    }
    const solved = solve(givens);
    if (!solved || solved.length !== 81) {
      rejects.nonUnique++;
      continue;
    }
    let matches = true;
    for (let i = 0; i < 81; i++) {
      if (solved[i] !== claimed[i]) {
        matches = false;
        break;
      }
    }
    if (!matches) {
      rejects.mismatch++;
      continue;
    }

    buckets[tier].push({
      difficulty: tier,
      code: puzzleCodeFor(givens),
      givens,
      solution: solved,
    });

    if (tiersFull(buckets)) {
      console.log(`All tiers reached target after ${scanned} rows.`);
      break;
    }
  }

  const totalsAfter = TIERS.map((t) => `${t}=${buckets[t].length}`).join(' ');
  console.log(`\nScan finished. Sampled: ${totalsAfter}`);
  console.log(
    `Rejects — parse:${rejects.parse} non-unique:${rejects.nonUnique} mismatch:${rejects.mismatch}`,
  );

  const total = TIERS.reduce((acc, t) => acc + buckets[t].length, 0);
  if (total === 0) {
    console.log('Nothing to insert. Exiting.');
    return;
  }

  // Flatten into a single insert array.
  const rows: Array<{
    difficulty: Difficulty;
    code: string;
    givens: number[];
    solution: number[];
  }> = [];
  for (const t of TIERS) rows.push(...buckets[t]);

  if (!admin) {
    console.log('Dry-run: skipping Supabase insert.');
    return;
  }

  console.log(`\nInserting ${rows.length} puzzles into Supabase in batches of ${BATCH_SIZE}…`);
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await admin.from('puzzles').insert(batch);
    if (error) {
      console.error(`Batch ${i}-${i + batch.length} failed: ${error.message}`);
      throw error;
    }
    process.stdout.write(`  inserted ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}\r`);
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
