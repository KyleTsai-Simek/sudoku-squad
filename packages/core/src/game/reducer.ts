import type { BoardState, Cell, Move } from '../types/index';
import { unitsFor } from '../puzzle/validator';
import { clearNote, toggleNote } from './notes';

/**
 * Apply a single move to a board, returning a new BoardState.
 *
 * Rules:
 *  - Writes (value/clear/note_toggle) to a given (clue) cell are refused — the
 *    returned state is the input unchanged. This is a pure no-op, not an error,
 *    because the UI is expected to prevent these and we want replay to be safe.
 *  - `value` sets the cell's value and clears its notes (a value supersedes notes).
 *    It ALSO auto-clears that value from the notes of every peer cell (same row,
 *    column, or 3x3 box). This is the universal "smart notes" / "auto-clean"
 *    behavior — see docs/GAME_DESIGN.md. Always on; no setting.
 *  - `clear` clears both value and notes — it's the eraser.
 *  - `note_toggle` flips the bit for `value` in the cell's notes. It is refused
 *    when the cell already has an entered value (notes only make sense in an
 *    empty cell).
 *
 * Pure function: never mutates `state`. Returns the same reference if the move
 * is a no-op, so reducers downstream can use referential equality if they want.
 */
export function applyMove(state: BoardState, move: Move): BoardState {
  const cell = state.cells[move.cell];
  if (!cell) return state;
  if (cell.given !== null) return state;

  let next: Cell;
  switch (move.kind) {
    case 'value': {
      const peersChange = wouldClearAnyPeerNote(state, move.cell, move.value);
      if (cell.value === move.value && cell.notes === 0 && !peersChange) return state;
      next = { given: cell.given, value: move.value, notes: 0 };
      const cells = state.cells.slice();
      cells[move.cell] = next;
      clearPeerNotes(cells, move.cell, move.value);
      return { puzzleCode: state.puzzleCode, cells };
    }
    case 'clear': {
      if (cell.value === null && cell.notes === 0) return state;
      next = { given: cell.given, value: null, notes: 0 };
      break;
    }
    case 'note_toggle': {
      if (cell.value !== null) return state;
      const nextNotes = toggleNote(cell.notes, move.value);
      if (nextNotes === cell.notes) return state;
      next = { given: cell.given, value: cell.value, notes: nextNotes };
      break;
    }
  }

  const cells = state.cells.slice();
  cells[move.cell] = next;
  return { puzzleCode: state.puzzleCode, cells };
}

/**
 * Remove `value` from the notes of every peer cell of `target` (same row, col,
 * or 3x3 box). Mutates the passed cells array in place — caller owns it.
 */
function clearPeerNotes(cells: Cell[], target: number, value: number): void {
  const { row, col, box } = unitsFor(target);
  for (let i = 0; i < 81; i++) {
    if (i === target) continue;
    const peer = cells[i];
    if (!peer || peer.notes === 0) continue;
    const u = unitsFor(i);
    if (u.row !== row && u.col !== col && u.box !== box) continue;
    const nextNotes = clearNote(peer.notes, value as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
    if (nextNotes !== peer.notes) {
      cells[i] = { given: peer.given, value: peer.value, notes: nextNotes };
    }
  }
}

/**
 * Cheap check whether the value-placement would actually clear at least one
 * peer note. Lets us preserve the reducer's "no-op returns same reference"
 * contract when the placement plus its auto-clean changes nothing.
 */
function wouldClearAnyPeerNote(state: BoardState, target: number, value: number): boolean {
  const { row, col, box } = unitsFor(target);
  const bit = 1 << (value - 1);
  for (let i = 0; i < 81; i++) {
    if (i === target) continue;
    const peer = state.cells[i];
    if (!peer || (peer.notes & bit) === 0) continue;
    const u = unitsFor(i);
    if (u.row === row || u.col === col || u.box === box) return true;
  }
  return false;
}

/** Apply a sequence of moves in order. Convenience for replay. */
export function applyMoves(state: BoardState, moves: ReadonlyArray<Move>): BoardState {
  let s = state;
  for (const m of moves) s = applyMove(s, m);
  return s;
}
