import { describe, expect, it } from 'vitest';
import { createBoard, isFilled } from './board';

const EMPTY_GIVENS = Array<number>(81).fill(0);
const SOLVED_BOARD: number[] = [
  5, 3, 4, 6, 7, 8, 9, 1, 2, 6, 7, 2, 1, 9, 5, 3, 4, 8, 1, 9, 8, 3, 4, 2, 5, 6, 7, 8, 5, 9, 7, 6, 1,
  4, 2, 3, 4, 2, 6, 8, 5, 3, 7, 9, 1, 7, 1, 3, 9, 2, 4, 8, 5, 6, 9, 6, 1, 5, 3, 7, 2, 8, 4, 2, 8, 7,
  4, 1, 9, 6, 3, 5, 3, 4, 5, 2, 8, 6, 1, 7, 9,
];

describe('createBoard', () => {
  it('creates 81 empty cells from all-zeros', () => {
    const board = createBoard('test', EMPTY_GIVENS);
    expect(board.cells).toHaveLength(81);
    for (const cell of board.cells) {
      expect(cell.given).toBeNull();
      expect(cell.value).toBeNull();
      expect(cell.notes).toBe(0);
    }
  });

  it('marks given cells correctly', () => {
    const board = createBoard('test', SOLVED_BOARD);
    expect(board.cells[0]?.given).toBe(5);
    expect(board.cells[80]?.given).toBe(9);
  });

  it('throws on wrong length', () => {
    expect(() => createBoard('test', [1, 2, 3])).toThrow();
  });

  it('throws on invalid given value', () => {
    const bad = [...EMPTY_GIVENS];
    bad[0] = 10;
    expect(() => createBoard('test', bad)).toThrow();
  });
});

describe('isFilled', () => {
  it('is true for a board where every cell is a given', () => {
    const board = createBoard('test', SOLVED_BOARD);
    expect(isFilled(board)).toBe(true);
  });

  it('is false for an empty board', () => {
    const board = createBoard('test', EMPTY_GIVENS);
    expect(isFilled(board)).toBe(false);
  });
});
