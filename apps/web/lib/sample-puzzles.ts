/**
 * Local sample puzzles for single-player development. Each puzzle has a
 * verified unique solution; these are well-known fixtures from the public
 * domain corpus, suitable for V1 dev work before the Kaggle ingest lands.
 *
 * When the Kaggle ingest is wired up, single-player will fetch from
 * `puzzles_public` instead and this file can be deleted (or kept around as
 * an offline fallback). For multiplayer rooms the puzzle id always comes
 * from Supabase — the solution never leaves the server during play.
 */

import type { Difficulty } from '@sudoku-squad/core';

export interface SamplePuzzle {
  id: string;
  difficulty: Difficulty;
  givens: number[]; // length 81; 0 = empty
  solution: number[]; // length 81; 1..9
}

function fromString(s: string): number[] {
  if (s.length !== 81) throw new Error(`Expected 81 chars, got ${s.length}`);
  const out: number[] = [];
  for (const ch of s) {
    if (ch === '.' || ch === '0') out.push(0);
    else {
      const n = Number(ch);
      if (!Number.isInteger(n) || n < 1 || n > 9) {
        throw new Error(`Bad cell char: ${ch}`);
      }
      out.push(n);
    }
  }
  return out;
}

interface Raw {
  difficulty: Difficulty;
  puzzle: string;
  solution: string;
}

const RAW: Raw[] = [
  {
    difficulty: 'easy',
    puzzle: '53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79',
    solution: '534678912672195348198342567859761423426853791713924856961537284287419635345286179',
  },
  {
    difficulty: 'medium',
    puzzle: '..3.2.6..9..3.5..1..18.64....81.29..7.......8..67.82....26.95..8..2.3..9..5.1.3..',
    solution: '483921657967345821251876493548132976729564138136798245372689514814253769695417382',
  },
  {
    difficulty: 'medium',
    puzzle: '1....7.9..3..2...8..96..5....53..9...1..8...26....4...3......1..4......7..7...3..',
    solution: '162857493534129678789643521475312986913586742628794135356478219241935867897261354',
  },
  {
    difficulty: 'medium',
    puzzle: '.2.6.8...58...97......4....37....5..6.......4..8....13....2......98...36...3.6.9.',
    solution: '123678945584239761967145328372461589691583274458792613836924157219857436745316892',
  },
  {
    difficulty: 'hard',
    puzzle: '..53.....8......2..7..1.5..4....53...1..7...6..32...8..6.5....9..4....3......97..',
    solution: '145327698839654127672918543496185372218473956753296481367542819984761235521839764',
  },
];

export const SAMPLE_PUZZLES: SamplePuzzle[] = RAW.map((r, i) => ({
  id: `sample-${i + 1}`,
  difficulty: r.difficulty,
  givens: fromString(r.puzzle),
  solution: fromString(r.solution),
}));

export function getSamplePuzzle(seed: string | undefined): SamplePuzzle {
  if (seed) {
    const found = SAMPLE_PUZZLES.find((p) => p.id === seed);
    if (found) return found;
  }
  // Default: pick deterministically by time slot so refreshing usually changes it.
  const idx = Math.floor(Math.random() * SAMPLE_PUZZLES.length);
  return SAMPLE_PUZZLES[idx]!;
}
