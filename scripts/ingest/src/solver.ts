/**
 * Norvig-style sudoku solver, used only at ingest time to verify puzzle uniqueness.
 *
 * Algorithm: constraint propagation + depth-first search.
 *  1. Each cell starts with possibilities {1..9}.
 *  2. Apply givens; for each, eliminate that digit from peers (row/col/box).
 *  3. When a cell has one possibility, that's its value — propagate to peers.
 *  4. If a unit has only one cell that can hold a digit, assign it.
 *  5. If propagation gets stuck, branch on the cell with fewest possibilities.
 *
 * Reference: https://norvig.com/sudoku.html
 *
 * THIS CODE MUST NOT BE IMPORTED BY packages/core OR apps/web.
 * It lives in scripts/ingest/ and runs only during dataset import.
 */

type Possibilities = number; // bitmask of digits 1..9; bit (d-1) set means d is possible
const ALL_DIGITS: Possibilities = 0b1_1111_1111;

interface Grid {
  cells: Possibilities[];
}

const PEERS = computePeers();

function computePeers(): number[][] {
  const peers: number[][] = [];
  for (let i = 0; i < 81; i++) {
    const r = Math.floor(i / 9);
    const c = i % 9;
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    const set = new Set<number>();
    for (let k = 0; k < 9; k++) {
      set.add(r * 9 + k);
      set.add(k * 9 + c);
      set.add((br + Math.floor(k / 3)) * 9 + (bc + (k % 3)));
    }
    set.delete(i);
    peers.push([...set]);
  }
  return peers;
}

function popcount(mask: number): number {
  let count = 0;
  let m = mask;
  while (m) {
    m &= m - 1;
    count++;
  }
  return count;
}

function lowestBit(mask: number): number {
  // Return the digit 1..9 of the lowest set bit, or 0 if none.
  if (mask === 0) return 0;
  return Math.log2(mask & -mask) + 1;
}

/** Parse an 81-int board (0 = empty) into a Grid with constraints propagated. */
function parse(board: ReadonlyArray<number>): Grid | null {
  const grid: Grid = { cells: new Array(81).fill(ALL_DIGITS) };
  for (let i = 0; i < 81; i++) {
    const d = board[i];
    if (d === undefined || d === 0) continue;
    if (!assign(grid, i, d)) return null;
  }
  return grid;
}

function assign(grid: Grid, cell: number, digit: number): boolean {
  const target = 1 << (digit - 1);
  const others = grid.cells[cell]! & ~target;
  let mask = others;
  while (mask) {
    const d = lowestBit(mask);
    mask &= mask - 1;
    if (!eliminate(grid, cell, d)) return false;
  }
  return true;
}

function eliminate(grid: Grid, cell: number, digit: number): boolean {
  const target = 1 << (digit - 1);
  if ((grid.cells[cell]! & target) === 0) return true; // already eliminated
  grid.cells[cell]! &= ~target;
  const remaining = grid.cells[cell]!;
  if (remaining === 0) return false; // contradiction
  if (popcount(remaining) === 1) {
    const d2 = lowestBit(remaining);
    for (const peer of PEERS[cell]!) {
      if (!eliminate(grid, peer, d2)) return false;
    }
  }
  return true;
}

/** Find one solution if any exists. Returns 81-int array or null. */
export function solve(board: ReadonlyArray<number>): number[] | null {
  const grid = parse(board);
  if (!grid) return null;
  const result = search(grid);
  if (!result) return null;
  return result.cells.map((m) => lowestBit(m));
}

/** Count solutions up to a cap. Returns 0, 1, or 2 (2 meaning "2+"). */
export function countSolutions(board: ReadonlyArray<number>, cap = 2): number {
  const grid = parse(board);
  if (!grid) return 0;
  return searchCount(grid, cap);
}

function search(grid: Grid): Grid | null {
  let minIdx = -1;
  let minCount = 10;
  for (let i = 0; i < 81; i++) {
    const m = grid.cells[i]!;
    const c = popcount(m);
    if (c > 1 && c < minCount) {
      minCount = c;
      minIdx = i;
    }
  }
  if (minIdx === -1) return grid; // solved

  let mask = grid.cells[minIdx]!;
  while (mask) {
    const d = lowestBit(mask);
    mask &= mask - 1;
    const copy: Grid = { cells: [...grid.cells] };
    if (assign(copy, minIdx, d)) {
      const result = search(copy);
      if (result) return result;
    }
  }
  return null;
}

function searchCount(grid: Grid, cap: number): number {
  let minIdx = -1;
  let minCount = 10;
  for (let i = 0; i < 81; i++) {
    const m = grid.cells[i]!;
    const c = popcount(m);
    if (c > 1 && c < minCount) {
      minCount = c;
      minIdx = i;
    }
  }
  if (minIdx === -1) return 1;

  let found = 0;
  let mask = grid.cells[minIdx]!;
  while (mask && found < cap) {
    const d = lowestBit(mask);
    mask &= mask - 1;
    const copy: Grid = { cells: [...grid.cells] };
    if (assign(copy, minIdx, d)) {
      found += searchCount(copy, cap - found);
      if (found >= cap) return cap;
    }
  }
  return found;
}

/** True iff the board has exactly one solution. */
export function hasUniqueSolution(board: ReadonlyArray<number>): boolean {
  return countSolutions(board, 2) === 1;
}
