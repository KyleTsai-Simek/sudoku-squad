/**
 * One-shot build script: convert apps/web/lib/data/usernames.csv into a JSON
 * the claim-username Edge Function can read at runtime.
 *
 *   pnpm tsx scripts/build-word-lists.ts
 *
 * Input:  apps/web/lib/data/usernames.csv  (two columns: adjective, noun)
 * Output: supabase/functions/_shared/word-lists.generated.json
 *
 * The CSV ships with a BOM (UTF-8 byte-order mark) from the source spreadsheet
 * tool. We strip it. Blank cells (the noun column extends past the adjective
 * column in our current file) are dropped.
 *
 * Re-run whenever the CSV changes. The generated JSON is committed so CI and
 * the Edge Function deploy don't need to re-run the script.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const CSV_PATH = resolve(ROOT, 'apps/web/lib/data/usernames.csv');
const OUT_PATH = resolve(ROOT, 'supabase/functions/_shared/word-lists.generated.json');

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function isCleanWord(s: string): boolean {
  if (!s || s.length === 0) return false;
  if (s.length > 30) return false;
  // Alphanumeric + hyphen + apostrophe, lowercase only. Reject anything weird
  // so we don't accidentally compose a username with whitespace or quotes.
  return /^[a-z][a-z0-9'-]*$/.test(s);
}

function main(): void {
  const raw = stripBom(readFileSync(CSV_PATH, 'utf8'));
  const lines = raw.split(/\r?\n/);
  const adjectives: string[] = [];
  const nouns: string[] = [];

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const [a, n] = line.split(',').map((x) => x.trim().toLowerCase());
    if (a && isCleanWord(a)) adjectives.push(a);
    if (n && isCleanWord(n)) nouns.push(n);
  }

  // Deduplicate while preserving order (in case the source has dupes).
  const uniq = (xs: string[]): string[] => Array.from(new Set(xs));
  const finalAdj = uniq(adjectives).sort();
  const finalNoun = uniq(nouns).sort();

  const out = {
    adjectives: finalAdj,
    nouns: finalNoun,
    combos: finalAdj.length * finalNoun.length,
    generatedAt: new Date().toISOString(),
  };

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(
    `Wrote ${OUT_PATH}\n  adjectives: ${finalAdj.length}\n  nouns: ${finalNoun.length}\n  combos: ${out.combos.toLocaleString()}`,
  );
}

main();
