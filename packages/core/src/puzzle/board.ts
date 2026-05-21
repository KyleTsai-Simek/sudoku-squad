import type { BoardArray, BoardState, Cell, CellValue, PuzzleId } from '../types/index';

/**
 * Build the initial BoardState from a puzzle's givens.
 *
 * @param puzzleId Identifier (UUID from Supabase) for the puzzle.
 * @param givens 81-int array; 0 means empty, 1..9 are clues.
 */
export function createBoard(puzzleId: PuzzleId, givens: BoardArray): BoardState {
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
  return { puzzleId, cells };
}

/** True if every non-given cell has a value (the board is fully filled). */
export function isFilled(board: BoardState): boolean {
  return board.cells.every((c) => c.given !== null || c.value !== null);
}

/** Resolve a cell's effective value (given takes priority over player value). */
export function cellValue(cell: Cell): CellValue | null {
  return cell.given ?? cell.value;
}
