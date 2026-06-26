/**
 * One-off: look up a single puzzle's tier (from DB) and raw rating (from
 * the source CSV via givens match). Useful for "how hard is this one?"
 *
 * Run: `pnpm --filter @sudoku-squad/ingest check:puzzle <code>`
 */

import 'dotenv/config';
import { createReadStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createClient } from '@supabase/supabase-js';

const code = process.argv[process.argv.length - 1];
if (!code || code.length !== 6) {
  console.error('Usage: pnpm check:puzzle <6-char-code>');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

function givensToString(givens: number[]): string {
  return givens.map((v) => (v === 0 ? '.' : String(v))).join('');
}

function countClues(givens: number[]): number {
  let n = 0;
  for (const v of givens) if (v !== 0) n++;
  return n;
}

async function main(): Promise<void> {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Looking up puzzle code: ${code}\n`);

  const { data, error } = await admin
    .from('puzzles')
    .select('code, difficulty, givens')
    .eq('code', code)
    .maybeSingle();
  if (error) {
    console.error(`DB error: ${error.message}`);
    process.exit(1);
  }
  if (!data) {
    console.error(`No puzzle with code "${code}" in DB.`);
    process.exit(1);
  }

  const row = data as { code: string; difficulty: string; givens: number[] };
  const clues = countClues(row.givens);
  console.log(`Tier:   ${row.difficulty}`);
  console.log(`Clues:  ${clues}`);
  console.log(`Givens: ${givensToString(row.givens)}`);
  console.log();

  // Now try to find the source CSV row by matching the puzzle string.
  const csvPath = resolve(process.cwd(), 'data/sudoku-3m.csv');
  if (!existsSync(csvPath)) {
    console.log('(scripts/ingest/data/sudoku-3m.csv not present; skipping raw-rating lookup.)');
    return;
  }
  const target = givensToString(row.givens);
  const stream = createReadStream(csvPath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let header: string[] | null = null;
  let scanned = 0;
  console.log('Scanning source CSV for raw rating ...');
  for await (const line of rl) {
    if (!line) continue;
    if (header === null) {
      header = line.split(',');
      continue;
    }
    scanned++;
    if (scanned % 500_000 === 0) {
      console.log(`  scanned ${scanned.toLocaleString()}`);
    }
    const fields = line.split(',');
    const puzzleIdx = header.indexOf('puzzle');
    const diffIdx = header.indexOf('difficulty');
    const idIdx = header.indexOf('id');
    if (fields[puzzleIdx] !== target) continue;
    const rating = Number(fields[diffIdx]);
    console.log(`\nFound at row ${(idIdx >= 0 ? fields[idIdx] : `#${scanned}`)}:`);
    console.log(`  Raw rating: ${rating}`);
    // Show the tier band it falls in (kept in sync with RATING_BANDS in
    // src/index.ts; see DECISIONS #0047 for the latest rename).
    let band = '';
    if (rating >= 0 && rating < 0.75) band = 'hard    [0.0, 0.75)';
    else if (rating < 2.5) band = 'expert  [0.75, 2.5)';
    else if (rating < 5.0) band = 'extreme [2.5, 5.0)';
    else if (rating < 7.0) band = 'killer  [5.0, 7.0)  (hidden tier)';
    else band = 'above 7.0 (out of bands)';
    console.log(`  Band:       ${band}`);
    rl.close();
    stream.destroy();
    return;
  }
  console.log(`Scanned ${scanned.toLocaleString()} rows; puzzle not matched in CSV.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
