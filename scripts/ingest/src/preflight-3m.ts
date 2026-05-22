/**
 * One-off preflight: scan the entire Kaggle 3M CSV and report what's actually
 * available across rating bands and clue counts. No DB writes, no solver — we
 * just want to understand the source distribution before re-bucketing.
 *
 * Run: `pnpm --filter @sudoku-squad/ingest preflight:3m`
 */

import { createReadStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

interface NewTier {
  name: string;
  // half-open: [lo, hi)
  lo: number;
  hi: number;
}

// Proposed bands. Half-open so every rating belongs to exactly one tier.
// Updated 2026-05-22 (afternoon pass) — old easy [0, 1.5) was still skewing too
// hard. Narrowing easy and absorbing the slack into medium / hard.
// Tier labels updated 2026-05-22 per #0034 (shift-up-one rename). The
// rating bands themselves are unchanged from #0032 — only the tier label
// pinned to each band shifted. QQWing-sourced warmup + easy don't appear
// here (they don't come from this CSV).
const NEW_TIERS: NewTier[] = [
  { name: 'medium', lo: 0,    hi: 0.75 },
  { name: 'hard',   lo: 0.75, hi: 2.5 },
  { name: 'expert', lo: 2.5,  hi: 5.0 },
  { name: 'killer', lo: 5.0,  hi: 7.0 },
];

function tierFor(rating: number): string | null {
  for (const t of NEW_TIERS) {
    if (rating >= t.lo && rating < t.hi) return t.name;
  }
  // Above 7.0: out-of-band (don't bin).
  if (rating >= 7.0) return 'above_7';
  return null;
}

async function main(): Promise<void> {
  const csvPath = resolve(process.cwd(), 'data/sudoku-3m.csv');
  if (!existsSync(csvPath)) {
    console.error(`Not found: ${csvPath}`);
    console.error('Expected scripts/ingest/data/sudoku-3m.csv. Re-download from Kaggle if missing.');
    process.exit(1);
  }
  console.log(`Scanning ${csvPath} ...`);

  const stream = createReadStream(csvPath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let header: string[] | null = null;
  let cluesIdx = -1;
  let diffIdx = -1;
  let scanned = 0;
  let parseErr = 0;

  // Per-tier, per-clue-count counters. Also rating histogram and overall clue histogram.
  const perTierClue = new Map<string, Map<number, number>>();
  const overallClue = new Map<number, number>();
  const ratingHist = new Map<number, number>(); // bucketed by 0.5
  const tierTotals = new Map<string, number>();

  for await (const raw of rl) {
    if (!raw) continue;
    if (header === null) {
      header = raw.split(',');
      cluesIdx = header.indexOf('clues');
      diffIdx = header.indexOf('difficulty');
      if (cluesIdx === -1 || diffIdx === -1) {
        console.error('Header missing clues/difficulty columns. Found:', header);
        process.exit(1);
      }
      continue;
    }
    scanned++;
    if (scanned % 500_000 === 0) {
      console.log(`  scanned ${scanned.toLocaleString()}`);
    }
    const fields = raw.split(',');
    const clues = Number(fields[cluesIdx]);
    const rating = Number(fields[diffIdx]);
    if (!Number.isFinite(clues) || !Number.isFinite(rating)) {
      parseErr++;
      continue;
    }
    overallClue.set(clues, (overallClue.get(clues) ?? 0) + 1);
    const rk = Math.floor(rating / 0.5) * 0.5;
    ratingHist.set(rk, (ratingHist.get(rk) ?? 0) + 1);
    const tier = tierFor(rating);
    if (!tier) continue;
    tierTotals.set(tier, (tierTotals.get(tier) ?? 0) + 1);
    const m = perTierClue.get(tier) ?? new Map<number, number>();
    m.set(clues, (m.get(clues) ?? 0) + 1);
    perTierClue.set(tier, m);
  }

  console.log(`\nScanned ${scanned.toLocaleString()} rows (parse errors: ${parseErr}).\n`);

  console.log('=== Overall rating histogram (bucket 0.5) ===');
  const ratingKeys = [...ratingHist.keys()].sort((a, b) => a - b);
  for (const k of ratingKeys) {
    const n = ratingHist.get(k)!;
    const pct = (n / scanned) * 100;
    const bar = '█'.repeat(Math.round(pct));
    console.log(`  [${k.toFixed(1)} – ${(k + 0.5).toFixed(1)})  ${n.toString().padStart(8)}  ${pct.toFixed(1)}%  ${bar}`);
  }
  console.log();

  console.log('=== Overall clue-count histogram ===');
  const cKeys = [...overallClue.keys()].sort((a, b) => a - b);
  for (const k of cKeys) {
    const n = overallClue.get(k)!;
    const pct = (n / scanned) * 100;
    const bar = '█'.repeat(Math.round(pct));
    console.log(`  ${k.toString().padStart(2)} clues  ${n.toString().padStart(8)}  ${pct.toFixed(1)}%  ${bar}`);
  }
  console.log();

  console.log('=== Per new-tier totals ===');
  for (const t of [...NEW_TIERS.map((x) => x.name), 'above_7']) {
    const n = tierTotals.get(t) ?? 0;
    console.log(`  ${t.padEnd(9)} ${n.toLocaleString()}`);
  }
  console.log();

  console.log('=== Per new-tier clue-count breakdown ===');
  for (const t of NEW_TIERS.map((x) => x.name)) {
    const m = perTierClue.get(t);
    if (!m) {
      console.log(`  ${t}: (none)`);
      continue;
    }
    const total = tierTotals.get(t) ?? 0;
    console.log(`  ${t}  (total ${total.toLocaleString()}):`);
    const keys = [...m.keys()].sort((a, b) => a - b);
    for (const k of keys) {
      const n = m.get(k)!;
      const pct = (n / total) * 100;
      const bar = '█'.repeat(Math.max(0, Math.round(pct / 2)));
      console.log(`     ${k.toString().padStart(2)} clues  ${n.toString().padStart(8)}  ${pct.toFixed(1)}%  ${bar}`);
    }
  }
  console.log();

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
