import type { BoardState, Cell, Move } from '../types/index';
import { applyMove } from './reducer';

/**
 * Client-side undo stack. Kept *separate* from the move reducer because the
 * reducer is replay-safe and must remain pure on (state, move) — but undo is
 * inherently stateful (you need the prior cells to restore).
 *
 * Each entry records the move that was applied along with the *prior* state of
 * every cell that changed. A `value` placement now auto-cleans peer notes in
 * the row/column/box, which means a single move can touch up to 21 cells —
 * the target plus up to 20 peers. We record the full prior set so undo
 * restores them all in one shot.
 *
 * To undo, restore each prior cell to its prior state. We do not pop the redo
 * stack on a fresh move — that's a deliberate simplification for V1; once you
 * make a new move after undoing, the redo history is dropped.
 *
 * This is local-only state. It is NOT what gets sent to the server.
 */

interface CellPrior {
  readonly index: number;
  readonly cell: Cell;
}

interface HistoryEntry {
  readonly move: Move;
  readonly priors: ReadonlyArray<CellPrior>;
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
 * Diff prev vs next by reference equality. The reducer only allocates new
 * Cell objects for cells whose contents actually changed, so referential
 * equality is a reliable signal here.
 */
function diffPriors(prev: BoardState, next: BoardState): ReadonlyArray<CellPrior> {
  const out: CellPrior[] = [];
  for (let i = 0; i < prev.cells.length; i++) {
    if (prev.cells[i] !== next.cells[i]) {
      out.push({ index: i, cell: prev.cells[i]! });
    }
  }
  return out;
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
  const priors = diffPriors(state, next);
  const entry: HistoryEntry = { move, priors };
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
  for (const p of top.priors) {
    cells[p.index] = p.cell;
  }
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
  // Re-diff because peer state may have shifted; this keeps undo accurate.
  const priors = diffPriors(state, next);
  const entry: HistoryEntry = { move: top.move, priors };
  return {
    state: next,
    history: {
      undoStack: [...history.undoStack, entry],
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
