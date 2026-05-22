import type { BoardState, Cell, Move } from '../types/index';
import { toggleNote } from './notes';

/**
 * Apply a single move to a board, returning a new BoardState.
 *
 * Rules:
 *  - Writes (value/clear/note_toggle) to a given (clue) cell are refused — the
 *    returned state is the input unchanged. This is a pure no-op, not an error,
 *    because the UI is expected to prevent these and we want replay to be safe.
 *  - `value` sets the cell's value and clears its notes (a value supersedes notes).
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
      if (cell.value === move.value && cell.notes === 0) return state;
      next = { given: cell.given, value: move.value, notes: 0 };
      break;
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

/** Apply a sequence of moves in order. Convenience for replay. */
export function applyMoves(state: BoardState, moves: ReadonlyArray<Move>): BoardState {
  let s = state;
  for (const m of moves) s = applyMove(s, m);
  return s;
}
