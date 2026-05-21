import type { BoardState, CellIndex } from '../types/index.js';
import { cellValue } from './board.js';

/**
 * Return the row, column, and 3x3 box indices for a cell.
 */
export function unitsFor(cell: CellIndex): { row: number; col: number; box: number } {
  const row = Math.floor(cell / 9);
  const col = cell % 9;
  const box = Math.floor(row / 3) * 3 + Math.floor(col / 3);
  return { row, col, box };
}

/**
 * Find all cells whose values violate sudoku rules vs. each other.
 * Does NOT compare against the solution — purely about rule conflicts.
 * Returns the set of cell indices that participate in any conflict.
 */
export function findConflicts(board: BoardState): Set<CellIndex> {
  const conflicts = new Set<CellIndex>();
  // For each row/col/box, group cells by value and flag any group >1.
  const groups: Array<Map<number, CellIndex[]>> = [];
  for (let i = 0; i < 27; i++) groups.push(new Map());

  for (let i = 0; i < 81; i++) {
    const cell = board.cells[i];
    if (!cell) continue;
    const v = cellValue(cell);
    if (v == null) continue;
    const { row, col, box } = unitsFor(i);
    const rowGroup = groups[row];
    const colGroup = groups[9 + col];
    const boxGroup = groups[18 + box];
    if (!rowGroup || !colGroup || !boxGroup) continue;
    for (const g of [rowGroup, colGroup, boxGroup]) {
      const list = g.get(v) ?? [];
      list.push(i);
      g.set(v, list);
    }
  }

  for (const g of groups) {
    for (const indices of g.values()) {
      if (indices.length > 1) {
        for (const idx of indices) conflicts.add(idx);
      }
    }
  }
  return conflicts;
}

/**
 * True iff the board is fully filled AND matches the provided solution exactly.
 * Solution comparison must NEVER happen on the client at gameplay time —
 * this function exists for server-side and ingest-time use.
 */
export function isCompleteWithSolution(
  board: BoardState,
  solution: ReadonlyArray<number>,
): boolean {
  if (solution.length !== 81) return false;
  for (let i = 0; i < 81; i++) {
    const cell = board.cells[i];
    if (!cell) return false;
    const v = cellValue(cell);
    if (v !== solution[i]) return false;
  }
  return true;
}
