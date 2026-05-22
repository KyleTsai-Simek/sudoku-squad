/**
 * One-off difficulty audit. Reports:
 *
 *   1. How many puzzles are in each tier (`easy` / `medium` / `hard` / `expert`).
 *   2. The clue-count distribution within each tier (a proxy for difficulty —
 *      fewer clues ≈ harder).
 *   3. The raw rating distribution within each tier, by matching the DB rows
 *      against the source CSV (Kaggle 3M dataset's numeric `difficulty` column).
 *      Optional — skipped if the CSV isn't present locally.
 *   4. The bucket boundaries used at ingest, for reference.
 *
 * Run: `pnpm --filter @sudoku-squad/ingest audit:difficulty`
 */

import 'dotenv/config';
import { createReadStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TIERS = ['easy', 'medium', 'hard', 'expert'] as const;
type Tier = (typeof TIERS)[number];

function countClues(givens: ReadonlyArray<number>): number {
  let n = 0;
  for (const v of givens) if (v !== 0) n++;
  return n;
}

function summarize(values: number[]): { min: number; p25: number; median: number; p75: number; max: number; mean: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { min: NaN, p25: NaN, median: NaN, p75: NaN, max: NaN, mean: NaN };
  const pick = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))]!;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  return {
    min: sorted[0]!,
    p25: pick(0.25),
    median: pick(0.5),
    p75: pick(0.75),
    max: sorted[n - 1]!,
    mean: Math.round(mean * 100) / 100,
  };
}

function histogram(values: number[], bucketSize: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const v of values) {
    const k = Math.floor(v / bucketSize) * bucketSize;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return new Map([...out].sort(([a], [b]) => a - b));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllPuzzles(admin: any): Promise<Array<{ code: string; difficulty: Tier; givens: number[] }>> {
  const out: Array<{ code: string; difficulty: Tier; givens: number[] }> = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from('puzzles')
      .select('code, difficulty, givens')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data as Array<{ code: string; difficulty: string; givens: number[] }>) {
      if (TIERS.includes(row.difficulty as Tier)) {
        out.push({ code: row.code, difficulty: row.difficulty as Tier, givens: row.givens });
      }
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

function givensToString(givens: number[]): string {
  return givens.map((v) => (v === 0 ? '.' : String(v))).join('');
}

async function maybeMatchRatings(
  puzzles: Array<{ code: string; difficulty: Tier; givens: number[] }>,
): Promise<Map<Tier, number[]> | null> {
  const csvPath = resolve(process.cwd(), 'data/sudoku-3m.csv');
  if (!existsSync(csvPath)) return null;

  // Build a lookup of normalized puzzle string → tier.
  const lookup = new Map<string, Tier>();
  for (const p of puzzles) {
    lookup.set(givensToString(p.givens), p.difficulty);
  }

  const ratingsByTier = new Map<Tier, number[]>(TIERS.map((t) => [t, [] as number[]]));
  let matched = 0;
  let scanned = 0;

  const stream = createReadStream(csvPath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let header: string[] | null = null;
  for await (const line of rl) {
    if (!line) continue;
    if (header === null) {
      header = line.split(',');
      continue;
    }
    scanned++;
    if (scanned % 500_000 === 0) {
      console.log(`    scanned ${scanned.toLocaleString()} rows, matched ${matched.toLocaleString()}`);
    }
    // Simple CSV parse — the 3M dataset has no quoted fields.
    const fields = line.split(',');
    const puzzleIdx = header.indexOf('puzzle');
    const diffIdx = header.indexOf('difficulty');
    if (puzzleIdx === -1 || diffIdx === -1) continue;
    const puzzle = fields[puzzleIdx];
    const diffStr = fields[diffIdx];
    if (!puzzle || !diffStr) continue;
    const tier = lookup.get(puzzle);
    if (tier === undefined) continue;
    const rating = Number(diffStr);
    if (!Number.isFinite(rating)) continue;
    ratingsByTier.get(tier)!.push(rating);
    matched++;
    if (matched === puzzles.length) break; // all done
  }
  console.log(`    scanned ${scanned.toLocaleString()} CSV rows, matched ${matched.toLocaleString()} / ${puzzles.length}`);
  return ratingsByTier;
}

async function main(): Promise<void> {
  if (!url || !serviceKey) {
    console.error('Missing env vars NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local.');
    process.exit(1);
  }

  console.log(`Auditing ${url} ...\n`);
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  console.log('Fetching all puzzles ...');
  const puzzles = await fetchAllPuzzles(admin);
  console.log(`  ${puzzles.length} rows fetched.\n`);

  // 1. Per-tier count
  console.log('=== Per-tier counts ===');
  const byTier = new Map<Tier, typeof puzzles>(TIERS.map((t) => [t, [] as typeof puzzles]));
  for (const p of puzzles) byTier.get(p.difficulty)!.push(p);
  for (const t of TIERS) {
    console.log(`  ${t.padEnd(7)} ${byTier.get(t)!.length.toLocaleString()}`);
  }
  console.log();

  // 2. Clue-count distribution per tier
  console.log('=== Clue counts per tier (min / p25 / median / p75 / max / mean) ===');
  for (const t of TIERS) {
    const clues = byTier.get(t)!.map((p) => countClues(p.givens));
    if (clues.length === 0) {
      console.log(`  ${t.padEnd(7)} —`);
      continue;
    }
    const s = summarize(clues);
    console.log(
      `  ${t.padEnd(7)} ${String(s.min).padStart(2)} / ${String(s.p25).padStart(2)} / ${String(s.median).padStart(2)} / ${String(s.p75).padStart(2)} / ${String(s.max).padStart(2)} / ${s.mean}`,
    );
  }
  console.log();

  // 3. Rating distribution from source CSV (if available)
  console.log('=== Source-CSV rating distribution (matching puzzles back to Kaggle 3M) ===');
  const ratings = await maybeMatchRatings(puzzles);
  if (!ratings) {
    console.log('  scripts/ingest/data/sudoku-3m.csv not present — skipping rating audit.');
  } else {
    console.log();
    console.log('  Stats per tier (min / p25 / median / p75 / max / mean):');
    for (const t of TIERS) {
      const r = ratings.get(t)!;
      if (r.length === 0) {
        console.log(`    ${t.padEnd(7)} —`);
        continue;
      }
      const s = summarize(r);
      console.log(
        `    ${t.padEnd(7)} ${s.min.toFixed(1)} / ${s.p25.toFixed(1)} / ${s.median.toFixed(1)} / ${s.p75.toFixed(1)} / ${s.max.toFixed(1)} / ${s.mean.toFixed(2)}`,
      );
    }
    console.log();
    console.log('  Histogram (bucket size 0.5):');
    for (const t of TIERS) {
      const r = ratings.get(t)!;
      if (r.length === 0) continue;
      const h = histogram(r, 0.5);
      console.log(`    ${t}:`);
      for (const [k, n] of h) {
        const bar = '█'.repeat(Math.round((n / r.length) * 40));
        console.log(`      [${k.toFixed(1)} – ${(k + 0.5).toFixed(1)})  ${String(n).padStart(5)}  ${bar}`);
      }
    }
  }
  console.log();

  // 4. Bucket boundaries used at ingest
  console.log('=== Ingest-time bucket boundaries (scripts/ingest/src/index.ts) ===');
  console.log('  By numeric rating (Kaggle 3M dataset `difficulty` column), half-open [lo, hi):');
  console.log('    easy    [0.0, 1.5)');
  console.log('    medium  [1.5, 4.0)');
  console.log('    hard    [4.0, 5.0)');
  console.log('    expert  [5.0, 7.0)');
  console.log('    (rows with rating ≥ 7.0 are skipped — outside every band)');
  console.log();
  console.log('  Per-(tier, clue-count) targets are configured in TARGET_PER_CELL.');
  console.log('  Easy biases toward more clues, expert toward fewer.');
  console.log();

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
