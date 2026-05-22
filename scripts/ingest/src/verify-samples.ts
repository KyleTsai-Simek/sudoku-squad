/**
 * One-shot verification of the apps/web sample puzzle pack. Reads the file,
 * solves each puzzle, checks uniqueness + solution match, and verifies that
 * the pinned `code` matches the puzzle-code algorithm.
 *
 * Run: `pnpm --filter @sudoku-squad/ingest verify:samples`
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { puzzleCodeFor } from './code';
import { hasUniqueSolution, solve } from './solver';

const SAMPLE_FILE = resolve(import.meta.dirname, '../../../apps/web/lib/sample-puzzles.ts');

interface Sample {
  code: string;
  puzzle: string;
  solution: string;
}

function extractRawArray(src: string): Sample[] {
  const m = src.match(/const RAW: Raw\[\] = \[([\s\S]*?)\];/);
  if (!m) throw new Error('Could not find RAW array in sample-puzzles.ts');
  const block = m[1]!;
  const out: Sample[] = [];
  // The fields appear in declaration order: code, difficulty, puzzle, solution.
  const re =
    /code:\s*'([^']+)'[\s\S]*?puzzle:\s*'([^']+)'[\s\S]*?solution:\s*'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block)) !== null) {
    out.push({ code: match[1]!, puzzle: match[2]!, solution: match[3]! });
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
  const { code, puzzle, solution } = samples[i]!;
  const givens = strToBoard(puzzle);
  const claimed = strToBoard(solution);

  const solved = solve(givens);
  const unique = hasUniqueSolution(givens);
  const matches =
    solved !== null && solved.length === 81 && solved.every((v, j) => v === claimed[j]);
  const expectedCode = puzzleCodeFor(givens);
  const codeOk = code === expectedCode;

  const status = unique && matches && codeOk ? 'OK' : 'FAIL';
  if (status === 'FAIL') allOk = false;
  console.log(
    `[${status}] sample-${i + 1}: unique=${unique} matches=${matches} code=${codeOk}`,
  );
  if (status === 'FAIL') {
    console.log(`  puzzle:   ${puzzle}`);
    console.log(`  claimed:  ${solution}`);
    if (solved) console.log(`  solver:   ${solved.join('')}`);
    if (!codeOk) console.log(`  code:     pinned=${code} expected=${expectedCode}`);
  }
}

process.exit(allOk ? 0 : 1);
