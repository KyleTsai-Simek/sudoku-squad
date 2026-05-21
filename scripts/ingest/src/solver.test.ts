import { describe, expect, it } from 'vitest';
import { countSolutions, hasUniqueSolution, solve } from './solver.js';

// Classic "world's hardest" sudoku — single solution, slow solvers struggle.
const HARD: number[] = [
  8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 6, 0, 0, 0, 0, 0, 0, 7, 0, 0, 9, 0, 2, 0, 0, 0, 5, 0, 0, 0, 7,
  0, 0, 0, 0, 0, 0, 0, 4, 5, 7, 0, 0, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 0, 1, 0, 0, 0, 0, 6, 8, 0, 0, 8,
  5, 0, 0, 0, 1, 0, 0, 9, 0, 0, 0, 0, 4, 0, 0,
];

const EASY: number[] = [
  5, 3, 0, 0, 7, 0, 0, 0, 0, 6, 0, 0, 1, 9, 5, 0, 0, 0, 0, 9, 8, 0, 0, 0, 0, 6, 0, 8, 0, 0, 0, 6, 0,
  0, 0, 3, 4, 0, 0, 8, 0, 3, 0, 0, 1, 7, 0, 0, 0, 2, 0, 0, 0, 6, 0, 6, 0, 0, 0, 0, 2, 8, 0, 0, 0, 0,
  4, 1, 9, 0, 0, 5, 0, 0, 0, 0, 8, 0, 0, 7, 9,
];

const EMPTY: number[] = Array<number>(81).fill(0);

describe('solver', () => {
  it('solves a classic easy puzzle', () => {
    const sol = solve(EASY);
    expect(sol).not.toBeNull();
    expect(sol).toHaveLength(81);
    // Spot-check known answer
    expect(sol![0]).toBe(5);
    expect(sol![80]).toBe(9);
  });

  it('solves the world-hardest puzzle', () => {
    const sol = solve(HARD);
    expect(sol).not.toBeNull();
    expect(sol![0]).toBe(8); // given
  });

  it('reports unique solution for a well-formed puzzle', () => {
    expect(hasUniqueSolution(EASY)).toBe(true);
  });

  it('reports >1 solution for an empty board', () => {
    expect(countSolutions(EMPTY, 2)).toBe(2);
    expect(hasUniqueSolution(EMPTY)).toBe(false);
  });
});
