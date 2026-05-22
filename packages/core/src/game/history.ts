import type { BoardState, Cell, Move } from '../types/index';
import { applyMove } from './reducer';

/**
 * Client-side undo stack. Kept *separate* from the move reducer because the
 * reducer is replay-safe and must remain pure on (state, move) — but undo is
 * inherently stateful (you need the prior cell to restore).
 *
 * Each entry records the move that was applied along with the *prior* state of
 * the affected cell. To undo, restore the cell to its prior state. We do not
 * pop the redo stack on a fresh move — that's a deliberate simplification for
 * V1; once you make a new move after undoing, the redo history is dropped.
 *
 * This is local-only state. It is NOT what gets sent to the server.
 */

interface HistoryEntry {
  readonly move: Move;
  readonly priorCell: Cell;
}

export interface MoveHistory {
  readonly undoStack: ReadonlyArray<HistoryEntry>;
  readonly redoStack: ReadonlyArray<HistoryEntry>;
}

export function createHistory(): MoveHistory {
  return { undoStack: [], redoStack: [] };
}

export interface ApplyResult {
  readonly state: BoardState;
  readonly history: MoveHistory;
}

/**
 * Apply a move and record it in history. If the move is a no-op (returns the
 * same state reference), history is left unchanged.
 *
 * Any pending redo history is discarded — the standard editor convention.
 */
export function applyMoveWithHistory(
  state: BoardState,
  history: MoveHistory,
  move: Move,
): ApplyResult {
  const priorCell = state.cells[move.cell];
  if (!priorCell) return { state, history };
  const next = applyMove(state, move);
  if (next === state) return { state, history };
  const entry: HistoryEntry = { move, priorCell };
  return {
    state: next,
    history: {
      undoStack: [...history.undoStack, entry],
      redoStack: [],
    },
  };
}

/**
 * Undo the most recent move. Returns the unchanged inputs if the stack is
 * empty. The undone entry is pushed onto the redo stack.
 */
export function undo(state: BoardState, history: MoveHistory): ApplyResult {
  const top = history.undoStack[history.undoStack.length - 1];
  if (!top) return { state, history };
  const cells = state.cells.slice();
  cells[top.move.cell] = top.priorCell;
  return {
    state: { puzzleCode: state.puzzleCode, cells },
    history: {
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [...history.redoStack, top],
    },
  };
}

/** Redo the most recently undone move. No-op if the redo stack is empty. */
export function redo(state: BoardState, history: MoveHistory): ApplyResult {
  const top = history.redoStack[history.redoStack.length - 1];
  if (!top) return { state, history };
  const next = applyMove(state, top.move);
  if (next === state) {
    // The board has diverged (e.g., another reducer touched this cell). Drop
    // the orphaned redo entry rather than silently ignoring it forever.
    return {
      state,
      history: { undoStack: history.undoStack, redoStack: history.redoStack.slice(0, -1) },
    };
  }
  return {
    state: next,
    history: {
      undoStack: [...history.undoStack, top],
      redoStack: history.redoStack.slice(0, -1),
    },
  };
}

export function canUndo(history: MoveHistory): boolean {
  return history.undoStack.length > 0;
}

export function canRedo(history: MoveHistory): boolean {
  return history.redoStack.length > 0;
}
