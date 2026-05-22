/**
 * One-shot verification of the apps/web sample puzzle pack. Reads the file,
 * solves each puzzle, and checks uniqueness + solution match.
 *
 * Run: `pnpm --filter @sudoku-squad/ingest verify:samples`
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasUniqueSolution, solve } from './solver';

const SAMPLE_FILE = resolve(import.meta.dirname, '../../../apps/web/lib/sample-puzzles.ts');

function extractRawArray(src: string): { puzzle: string; solution: string }[] {
  const m = src.match(/const RAW: Raw\[\] = \[([\s\S]*?)\];/);
  if (!m) throw new Error('Could not find RAW array in sample-puzzles.ts');
  const block = m[1]!;
  const out: { puzzle: string; solution: string }[] = [];
  const re = /puzzle:\s*'([^']+)'[\s\S]*?solution:\s*'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block)) !== null) {
    out.push({ puzzle: match[1]!, solution: match[2]! });
  }
  return out;
}

function strToBoard(s: string): number[] {
  return [...s].map((ch) => (ch === '.' || ch === '0' ? 0 : Number(ch)));
}

const src = readFileSync(SAMPLE_FILE, 'utf8');
const samples = extractRawArray(src);

let allOk = true;
for (let i = 0; i < samples.length; i++) {
  const { puzzle, solution } = samples[i]!;
  const givens = strToBoard(puzzle);
  const claimed = strToBoard(solution);

  const solved = solve(givens);
  const unique = hasUniqueSolution(givens);
  const matches =
    solved !== null && solved.length === 81 && solved.every((v, j) => v === claimed[j]);

  const status = unique && matches ? 'OK' : 'FAIL';
  if (status === 'FAIL') allOk = false;
  console.log(`[${status}] sample-${i + 1}: unique=${unique} matches=${matches}`);
  if (status === 'FAIL') {
    console.log(`  puzzle:   ${puzzle}`);
    console.log(`  claimed:  ${solution}`);
    if (solved) console.log(`  solver:   ${solved.join('')}`);
  }
}

process.exit(allOk ? 0 : 1);
