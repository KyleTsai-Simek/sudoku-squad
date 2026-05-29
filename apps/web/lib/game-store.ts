'use client';

import { create } from 'zustand';
import {
  applyMoveWithHistory,
  canRedo,
  canUndo,
  createBoard,
  createHistory,
  findConflicts,
  isCompleteWithSolution,
  isFilled,
  peekLastMove,
  redo as redoHistory,
  undo as undoHistory,
} from '@sudoku-squad/core';
import type { BoardState, CellIndex, CellValue, Move, MoveHistory } from '@sudoku-squad/core';
import type { FetchedPuzzle } from './puzzle-source';
import { recordSinglePlayerCompletion } from './completions';

export interface GameSettings {
  showConflicts: boolean;
  autoCheck: boolean;
  highlightSameValue: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  showConflicts: true,
  autoCheck: false,
  highlightSameValue: true,
};

interface GameState {
  puzzle: FetchedPuzzle | null;
  board: BoardState | null;
  history: MoveHistory;
  selected: CellIndex | null;
  notesMode: boolean;
  settings: GameSettings;
  startedAt: number | null;
  finishedAt: number | null;
  hintsUsed: number;
  conflicts: Set<CellIndex>;
  incorrect: Set<CellIndex>; // populated only when autoCheck is on

  // actions
  startGame: (puzzle: FetchedPuzzle) => void;
  /** Restore a previously-persisted in-progress game (see lib/sp-persistence).
   *  `startedAt` is expected to be already rebased by the caller so elapsed
   *  time excludes the away period. Derived state is recomputed locally. */
  hydrate: (snapshot: {
    puzzle: FetchedPuzzle;
    board: BoardState;
    history: MoveHistory;
    startedAt: number;
    finishedAt: number | null;
    hintsUsed: number;
    notesMode: boolean;
  }) => void;
  resetGame: () => void;
  selectCell: (cell: CellIndex | null) => void;
  moveSelection: (dx: number, dy: number) => void;
  toggleNotesMode: () => void;
  setNotesMode: (on: boolean) => void;
  enterValue: (value: CellValue) => void;
  /**
   * One-shot pencil-mark toggle on the selected cell, regardless of notesMode.
   * Wired to Shift+digit so users can drop a note without flipping modes.
   */
  enterNote: (value: CellValue) => void;
  clearCell: () => void;
  undo: () => void;
  redo: () => void;
  setSetting: <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => void;
  useHint: () => void;
}

function recomputeDerived(
  board: BoardState,
  settings: GameSettings,
  solution: number[],
): { conflicts: Set<CellIndex>; incorrect: Set<CellIndex> } {
  const conflicts = settings.showConflicts ? findConflicts(board) : new Set<CellIndex>();
  const incorrect = new Set<CellIndex>();
  if (settings.autoCheck) {
    for (let i = 0; i < 81; i++) {
      const cell = board.cells[i]!;
      if (cell.given !== null) continue;
      if (cell.value !== null && cell.value !== solution[i]) {
        incorrect.add(i);
      }
    }
  }
  return { conflicts, incorrect };
}

function isWon(board: BoardState, solution: number[]): boolean {
  return isFilled(board) && isCompleteWithSolution(board, solution);
}

export const useGameStore = create<GameState>((set, get) => ({
  puzzle: null,
  board: null,
  history: createHistory(),
  selected: null,
  notesMode: false,
  settings: DEFAULT_SETTINGS,
  startedAt: null,
  finishedAt: null,
  hintsUsed: 0,
  conflicts: new Set(),
  incorrect: new Set(),

  startGame: (puzzle) => {
    const board = createBoard(puzzle.code, puzzle.givens);
    const { settings } = get();
    const derived = recomputeDerived(board, settings, puzzle.solution);
    set({
      puzzle,
      board,
      history: createHistory(),
      selected: null,
      notesMode: false,
      startedAt: Date.now(),
      finishedAt: null,
      hintsUsed: 0,
      conflicts: derived.conflicts,
      incorrect: derived.incorrect,
    });
  },

  hydrate: (snapshot) => {
    const { settings } = get();
    const derived = recomputeDerived(snapshot.board, settings, snapshot.puzzle.solution);
    set({
      puzzle: snapshot.puzzle,
      board: snapshot.board,
      history: snapshot.history,
      selected: null,
      notesMode: snapshot.notesMode,
      startedAt: snapshot.startedAt,
      finishedAt: snapshot.finishedAt,
      hintsUsed: snapshot.hintsUsed,
      conflicts: derived.conflicts,
      incorrect: derived.incorrect,
    });
  },

  resetGame: () => {
    const { puzzle } = get();
    if (puzzle) get().startGame(puzzle);
  },

  selectCell: (cell) => set({ selected: cell }),

  moveSelection: (dx, dy) => {
    const cur = get().selected ?? 40; // center
    const row = Math.floor(cur / 9);
    const col = cur % 9;
    const nr = Math.max(0, Math.min(8, row + dy));
    const nc = Math.max(0, Math.min(8, col + dx));
    set({ selected: nr * 9 + nc });
  },

  toggleNotesMode: () => set({ notesMode: !get().notesMode }),
  setNotesMode: (on) => set({ notesMode: on }),

  enterValue: (value) => {
    const { board, selected, puzzle, notesMode, finishedAt } = get();
    if (!board || !puzzle || selected === null || finishedAt !== null) return;
    const cell = board.cells[selected];
    if (!cell || cell.given !== null) return;

    // Re-typing the value that's already in the cell acts as a clear (which
    // itself becomes a smart-undo when the placement was the most recent
    // move — see clearCell). Notes mode is a true toggle and falls through.
    if (!notesMode && cell.value === value) {
      get().clearCell();
      return;
    }

    const { history, settings } = get();
    const move: Move = notesMode
      ? { kind: 'note_toggle', cell: selected, value }
      : { kind: 'value', cell: selected, value };

    const result = applyMoveWithHistory(board, history, move);
    if (result.state === board) return;
    const derived = recomputeDerived(result.state, settings, puzzle.solution);
    const won = isWon(result.state, puzzle.solution);
    if (won) void recordSinglePlayerCompletion(puzzle.code);
    set({
      board: result.state,
      history: result.history,
      conflicts: derived.conflicts,
      incorrect: derived.incorrect,
      finishedAt: won ? Date.now() : null,
    });
  },

  enterNote: (value) => {
    const { board, selected, history, puzzle, settings, finishedAt } = get();
    if (!board || !puzzle || selected === null || finishedAt !== null) return;
    const cell = board.cells[selected];
    if (!cell || cell.given !== null) return;
    const result = applyMoveWithHistory(board, history, {
      kind: 'note_toggle',
      cell: selected,
      value,
    });
    if (result.state === board) return;
    const derived = recomputeDerived(result.state, settings, puzzle.solution);
    set({
      board: result.state,
      history: result.history,
      conflicts: derived.conflicts,
      incorrect: derived.incorrect,
    });
  },

  clearCell: () => {
    const { board, selected, history, puzzle, settings, finishedAt } = get();
    if (!board || !puzzle || selected === null || finishedAt !== null) return;
    const cell = board.cells[selected];
    if (!cell || cell.given !== null) return;

    // Smart-clear: if the most recent move was placing exactly the value
    // that's currently in this cell, treat the clear as an undo. That way
    // auto-cleaned peer notes come back instead of being permanently lost.
    const last = peekLastMove(history);
    if (
      last &&
      last.kind === 'value' &&
      last.cell === selected &&
      cell.value === last.value
    ) {
      get().undo();
      return;
    }

    const result = applyMoveWithHistory(board, history, { kind: 'clear', cell: selected });
    if (result.state === board) return;
    const derived = recomputeDerived(result.state, settings, puzzle.solution);
    set({
      board: result.state,
      history: result.history,
      conflicts: derived.conflicts,
      incorrect: derived.incorrect,
    });
  },

  undo: () => {
    const { board, history, puzzle, settings } = get();
    if (!board || !puzzle || !canUndo(history)) return;
    const result = undoHistory(board, history);
    const derived = recomputeDerived(result.state, settings, puzzle.solution);
    set({
      board: result.state,
      history: result.history,
      conflicts: derived.conflicts,
      incorrect: derived.incorrect,
    });
  },

  redo: () => {
    const { board, history, puzzle, settings } = get();
    if (!board || !puzzle || !canRedo(history)) return;
    const result = redoHistory(board, history);
    const derived = recomputeDerived(result.state, settings, puzzle.solution);
    const won = isWon(result.state, puzzle.solution);
    if (won && get().finishedAt === null) void recordSinglePlayerCompletion(puzzle.code);
    set({
      board: result.state,
      history: result.history,
      conflicts: derived.conflicts,
      incorrect: derived.incorrect,
      finishedAt: won ? Date.now() : get().finishedAt,
    });
  },

  setSetting: (key, value) => {
    const settings = { ...get().settings, [key]: value };
    const { board, puzzle } = get();
    if (!board || !puzzle) {
      set({ settings });
      return;
    }
    const derived = recomputeDerived(board, settings, puzzle.solution);
    set({ settings, conflicts: derived.conflicts, incorrect: derived.incorrect });
  },

  useHint: () => {
    const { board, puzzle, history, settings, selected, finishedAt } = get();
    if (!board || !puzzle || finishedAt !== null) return;

    // Prefer the currently selected cell if it's empty and not a given.
    let target: CellIndex | null = null;
    if (selected !== null) {
      const c = board.cells[selected];
      if (c && c.given === null && c.value === null) target = selected;
    }
    // Otherwise, pick the first empty non-given cell.
    if (target === null) {
      for (let i = 0; i < 81; i++) {
        const c = board.cells[i]!;
        if (c.given === null && c.value === null) {
          target = i;
          break;
        }
      }
    }
    if (target === null) return;

    const value = puzzle.solution[target] as CellValue;
    const result = applyMoveWithHistory(board, history, {
      kind: 'value',
      cell: target,
      value,
    });
    if (result.state === board) return;
    const derived = recomputeDerived(result.state, settings, puzzle.solution);
    const won = isWon(result.state, puzzle.solution);
    if (won) void recordSinglePlayerCompletion(puzzle.code);
    set({
      board: result.state,
      history: result.history,
      selected: target,
      conflicts: derived.conflicts,
      incorrect: derived.incorrect,
      hintsUsed: get().hintsUsed + 1,
      finishedAt: won ? Date.now() : null,
    });
  },
}));

export function selectCanUndo(s: GameState): boolean {
  return canUndo(s.history);
}
export function selectCanRedo(s: GameState): boolean {
  return canRedo(s.history);
}
