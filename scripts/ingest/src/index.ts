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

/**
 * Rating bands (half-open: [lo, hi)) applied to the 3M dataset's numeric
 * `difficulty` column. Updated 2026-05-22 (afternoon) — old easy [0, 1.5)
 * skewed too hard in practice because the band included rating-1.0-to-1.4
 * puzzles that solved like medium. Narrowed easy and shifted the slack
 * into medium/hard. See docs/DECISIONS.md #0032 (supersedes #0031).
 */
const RATING_BANDS: ReadonlyArray<{ tier: Difficulty; lo: number; hi: number }> = [
  { tier: 'easy',   lo: 0.0,  hi: 0.75 },
  { tier: 'medium', lo: 0.75, hi: 2.5 },
  { tier: 'hard',   lo: 2.5,  hi: 5.0 },
  { tier: 'expert', lo: 5.0,  hi: 7.0 },
];

/**
 * Per-(tier, clue-count) target distribution. Designed so easy leans toward
 * more clues, expert leans toward fewer, with monotonic shifts across tiers.
 * Within the 3M dataset's narrow clue-count support (94% of rows are 23-26
 * clues), these targets are feasible — each cell's source-row availability
 * was confirmed by the preflight scan. Totals to 2,500 per tier (10,000 total).
 *
 * If a cell is unreachable (source rows insufficient), the script will warn
 * and leave the bucket short rather than fail.
 */
const TARGET_PER_CELL: Record<Difficulty, Record<number, number>> = {
  // Stronger lean toward MORE clues. Mode at 27.
  easy:   { 23: 50,  24: 100, 25: 250, 26: 600, 27: 1000, 28: 500 },
  // Roughly balanced around 24-25.
  medium: { 22: 100, 23: 400, 24: 700, 25: 700, 26: 450,  27: 150 },
  // Lean toward FEWER clues. Mode at 23.
  hard:   { 21: 150, 22: 750, 23: 950, 24: 500, 25: 125,  26: 25 },
  // Strong lean toward fewest clues. Take all available at clue counts 20-21.
  expert: { 20: 4,   21: 87,  22: 800, 23: 1200, 24: 350, 25: 50, 26: 9 },
};

const BATCH_SIZE = 500;
const PROGRESS_EVERY = 50000;

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

/** Classify by numeric rating using the current RATING_BANDS. Returns null
 *  for ratings outside any band (e.g. ≥ 7.0). */
function tierForRating(n: number): Difficulty | null {
  for (const b of RATING_BANDS) {
    if (n >= b.lo && n < b.hi) return b.tier;
  }
  return null;
}

/** Map a free-form difficulty label from the dataset to one of our four tiers. */
function normalizeDifficulty(label: string): Difficulty | null {
  const v = label.trim().toLowerCase();
  if (!v) return null;
  if (v === 'easy' || v === 'simple' || v === '1') return 'easy';
  if (v === 'medium' || v === 'moderate' || v === '2') return 'medium';
  if (v === 'hard' || v === 'difficult' || v === '3') return 'hard';
  if (v === 'expert' || v === 'evil' || v === 'insane' || v === '4') return 'expert';
  // Numeric rating: use the current bands.
  const n = Number(v);
  if (Number.isFinite(n)) return tierForRating(n);
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

/**
 * Returns the tier for a row, or null to indicate "skip this row entirely."
 *
 * Logic:
 *  - If a rating/difficulty label is present and parses to one of our tiers,
 *    use it.
 *  - If the label is present but the parsed numeric rating falls OUTSIDE
 *    every configured band (e.g., rating ≥ 7.0 with the current bands),
 *    return null — never fall through to the clue-count heuristic. The
 *    explicit rating is authoritative; treating a rating-7.5 puzzle as
 *    "expert" via clue-count would silently include puzzles harder than
 *    our top band.
 *  - Only if NO label is present at all do we fall back to clue count.
 */
function difficultyForRow(
  row: Record<string, string>,
  clues: number,
): Difficulty | null {
  const label =
    row['difficulty'] ??
    row['level'] ??
    row['rating'] ??
    row['difficulty_rating'] ??
    null;
  if (label) {
    return normalizeDifficulty(label); // may be null → skip
  }
  return difficultyFromClues(clues);
}

/** Aggregate target for a given (tier, clues) cell, or 0 if not configured. */
function targetFor(tier: Difficulty, clues: number): number {
  return TARGET_PER_CELL[tier][clues] ?? 0;
}

/** Sum of every cell's target across all tiers. */
function totalTarget(): number {
  let n = 0;
  for (const t of TIERS) {
    for (const v of Object.values(TARGET_PER_CELL[t])) n += v;
  }
  return n;
}

interface CellCounter {
  filled: number;
  target: number;
}

function buildCellCounters(): Record<Difficulty, Map<number, CellCounter>> {
  const out = {} as Record<Difficulty, Map<number, CellCounter>>;
  for (const t of TIERS) {
    const m = new Map<number, CellCounter>();
    for (const [clueStr, target] of Object.entries(TARGET_PER_CELL[t])) {
      m.set(Number(clueStr), { filled: 0, target });
    }
    out[t] = m;
  }
  return out;
}

function allCellsFull(counters: Record<Difficulty, Map<number, CellCounter>>): boolean {
  for (const t of TIERS) {
    for (const c of counters[t].values()) {
      if (c.filled < c.target) return false;
    }
  }
  return true;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const truncate = process.argv.includes('--truncate');
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
  console.log('Rating bands:');
  for (const b of RATING_BANDS) {
    console.log(`  ${b.tier.padEnd(7)} [${b.lo.toFixed(1)}, ${b.hi.toFixed(1)})`);
  }
  console.log(`Total target across all (tier, clues) cells: ${totalTarget()}`);

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
    if (truncate) {
      console.log(
        '\n--truncate set: wiping puzzles + everything that references it (player_completions, rooms — which cascades to room_players + moves).',
      );
      // Service-role bypasses RLS. Delete in dependency order. We use a
      // `.neq()` filter because PostgREST refuses unfiltered DELETE; the
      // sentinel value (zero UUID / empty string) can't legitimately match
      // any real row, so the filter is effectively a no-op and we hit every
      // row. room_players + moves get cleared via `on delete cascade` when
      // rooms goes.
      const zeroUuid = '00000000-0000-0000-0000-000000000000';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = admin as any;
      const deleters: Array<{ table: string; whereCol: string; whereVal: string }> = [
        { table: 'player_completions', whereCol: 'puzzle_code', whereVal: '___sentinel___' },
        { table: 'rooms',              whereCol: 'id',          whereVal: zeroUuid },
        { table: 'puzzles',            whereCol: 'id',          whereVal: zeroUuid },
      ];
      for (const d of deleters) {
        const before = await a.from(d.table).select('*', { count: 'exact', head: true });
        const { error } = await a.from(d.table).delete().neq(d.whereCol, d.whereVal);
        if (error) {
          throw new Error(`Could not clear ${d.table}: ${error.message}`);
        }
        const after = await a.from(d.table).select('*', { count: 'exact', head: true });
        console.log(`  ${d.table}: ${before.count ?? 0} → ${after.count ?? 0}`);
      }
    } else if ((existing ?? 0) > 0) {
      console.log(
        'Note: appending to existing rows. Pass --truncate to wipe and rebuild from scratch.',
      );
    }
  } else {
    console.log('Dry-run mode: Supabase writes disabled.');
  }

  const counters = buildCellCounters();
  const buckets: Record<Difficulty, SampledPuzzle[]> = { easy: [], medium: [], hard: [], expert: [] };
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

    const clues = countClues(givens);
    const tier = difficultyForRow(row, clues);
    if (!tier) continue; // rating present but outside every band
    // Skip cells that don't have a target (e.g., clue count outside the
    // configured range) or are already full.
    const cell = counters[tier].get(clues);
    if (!cell || cell.filled >= cell.target) continue;

    // Verify uniqueness — load-bearing per DECISIONS.md #0011/#0012.
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
    cell.filled++;

    if (allCellsFull(counters)) {
      console.log(`All (tier, clues) cells reached target after ${scanned} rows.`);
      break;
    }
  }

  const totalsAfter = TIERS.map((t) => `${t}=${buckets[t].length}`).join(' ');
  console.log(`\nScan finished. Sampled: ${totalsAfter}`);
  console.log(
    `Rejects — parse:${rejects.parse} non-unique:${rejects.nonUnique} mismatch:${rejects.mismatch}`,
  );

  // Per-cell achievement report — flag any unfilled cells.
  console.log('\nPer-cell achievement:');
  for (const t of TIERS) {
    const parts: string[] = [];
    let short = false;
    for (const [clues, c] of [...counters[t].entries()].sort((a, b) => a[0] - b[0])) {
      const tag = c.filled < c.target ? ` (SHORT: target ${c.target})` : '';
      if (c.filled < c.target) short = true;
      parts.push(`${clues}c=${c.filled}${tag}`);
    }
    console.log(`  ${t.padEnd(7)} ${parts.join(', ')}${short ? '  ← under target' : ''}`);
  }

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
