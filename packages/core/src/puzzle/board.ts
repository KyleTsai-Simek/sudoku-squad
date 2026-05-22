import type { BoardArray, BoardState, Cell, CellValue, PuzzleCode } from '../types/index';

/**
 * Build the initial BoardState from a puzzle's givens.
 *
 * @param puzzleCode The puzzle's short hash (matches the URL slug and `puzzles.code`).
 * @param givens 81-int array; 0 means empty, 1..9 are clues.
 */
export function createBoard(puzzleCode: PuzzleCode, givens: BoardArray): BoardState {
  if (givens.length !== 81) {
    throw new Error(`Expected 81 givens, got ${givens.length}`);
  }
  const cells: Cell[] = givens.map((g) => {
    if (g === 0) {
      return { given: null, value: null, notes: 0 };
    }
    if (g < 1 || g > 9 || !Number.isInteger(g)) {
      throw new Error(`Invalid given value: ${g}`);
    }
    return { given: g as CellValue, value: null, notes: 0 };
  });
  return { puzzleCode, cells };
}

/** True if every non-given cell has a value (the board is fully filled). */
export function isFilled(board: BoardState): boolean {
  return board.cells.every((c) => c.given !== null || c.value !== null);
}

/** Resolve a cell's effective value (given takes priority over player value). */
export function cellValue(cell: Cell): CellValue | null {
  return cell.given ?? cell.value;
}

/**
 * Count how many cells hold each digit 1..9 (combining givens + player values).
 * A digit with count === 9 is considered "complete" — every instance of that
 * digit has been placed somewhere on the board. The UI uses this for soft-green
 * tinting and to flag completed buttons on the number pad.
 *
 * Returns a Map; callers that want just the completed set can do
 * `new Set([...counts].filter(([, n]) => n === 9).map(([v]) => v))`.
 */
export function digitCounts(board: BoardState): Map<CellValue, number> {
  const out = new Map<CellValue, number>();
  for (const cell of board.cells) {
    const v = cellValue(cell);
    if (v === null) continue;
    out.set(v, (out.get(v) ?? 0) + 1);
  }
  return out;
}
