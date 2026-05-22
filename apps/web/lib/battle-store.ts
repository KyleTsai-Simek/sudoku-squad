'use client';

import { create } from 'zustand';
import {
  applyMoveWithHistory,
  canRedo,
  canUndo,
  createBoard,
  createHistory,
  findConflicts,
  redo as redoHistory,
  undo as undoHistory,
} from '@sudoku-squad/core';
import type {
  BoardState,
  CellIndex,
  CellValue,
  Move,
  MoveHistory,
  PuzzleCode,
} from '@sudoku-squad/core';
import {
  submitMove,
  DEFAULT_ROOM_SETTINGS,
  type RoomSettings,
  type RoomState,
} from './rooms';

/**
 * Battle-mode local state. Like game-store.ts but:
 *   - No `solution` client-side (server-authoritative).
 *   - No local win detection — the server broadcasts winner via the rooms row.
 *   - No hint/auto-check locally (those need server endpoints, Phase 2+).
 *   - Every value/clear/note_toggle calls submit-move in the background.
 *
 * We apply moves optimistically and don't wait for the server echo. Network
 * errors from submit-move are surfaced into `lastError` so the UI can show
 * a small toast. For V1 we don't roll back on rejection — a real reconcile
 * loop lands when coop's LWW semantics force the issue.
 */

interface BattleState {
  room: RoomState | null;
  puzzleCode: PuzzleCode | null;
  board: BoardState | null;
  history: MoveHistory;
  selected: CellIndex | null;
  notesMode: boolean;
  settings: RoomSettings;
  conflicts: Set<CellIndex>;
  /** Server-flagged incorrect cells when settings.autoCheck is on. */
  incorrect: Set<CellIndex>;
  startedAt: number | null;
  finishedAt: number | null;
  ownProgressPct: number;
  lastError: string | null;

  // actions
  /** `gameStartsAt` is the absolute timestamp (ms) at which input is unlocked
   *  — i.e. `serverStartedAt + 5000`. The elapsed display reads from this. */
  startBattle: (
    room: RoomState,
    puzzleCode: PuzzleCode,
    givens: number[],
    settings: RoomSettings,
    gameStartsAt: number,
  ) => void;
  applySettings: (settings: RoomSettings) => void;
  selectCell: (cell: CellIndex | null) => void;
  moveSelection: (dx: number, dy: number) => void;
  toggleNotesMode: () => void;
  setNotesMode: (on: boolean) => void;
  enterValue: (value: CellValue) => Promise<void>;
  clearCell: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  markFinished: () => void;
}

function recomputeConflicts(board: BoardState, on: boolean): Set<CellIndex> {
  return on ? findConflicts(board) : new Set<CellIndex>();
}

export const useBattleStore = create<BattleState>((set, get) => ({
  room: null,
  puzzleCode: null,
  board: null,
  history: createHistory(),
  selected: null,
  notesMode: false,
  settings: { ...DEFAULT_ROOM_SETTINGS },
  conflicts: new Set(),
  incorrect: new Set(),
  startedAt: null,
  finishedAt: null,
  ownProgressPct: 0,
  lastError: null,

  startBattle: (room, puzzleCode, givens, settings, gameStartsAt) => {
    const board = createBoard(puzzleCode, givens);
    set({
      room,
      puzzleCode,
      board,
      history: createHistory(),
      selected: null,
      notesMode: false,
      settings,
      conflicts: recomputeConflicts(board, settings.showConflicts),
      incorrect: new Set(),
      startedAt: gameStartsAt,
      finishedAt: null,
      ownProgressPct: 0,
      lastError: null,
    });
  },

  applySettings: (settings) => {
    const { board } = get();
    set({
      settings,
      conflicts: board ? recomputeConflicts(board, settings.showConflicts) : new Set(),
      // Clear incorrect flags when autoCheck flips off; otherwise leave them.
      incorrect: settings.autoCheck ? get().incorrect : new Set(),
    });
  },

  selectCell: (cell) => set({ selected: cell }),

  moveSelection: (dx, dy) => {
    const cur = get().selected ?? 40;
    const row = Math.floor(cur / 9);
    const col = cur % 9;
    const nr = Math.max(0, Math.min(8, row + dy));
    const nc = Math.max(0, Math.min(8, col + dx));
    set({ selected: nr * 9 + nc });
  },

  toggleNotesMode: () => set({ notesMode: !get().notesMode }),
  setNotesMode: (on) => set({ notesMode: on }),

  enterValue: async (value) => {
    const { board, selected, history, room, settings, notesMode, finishedAt, startedAt } = get();
    if (!board || !room || selected === null || finishedAt !== null) return;
    // Countdown lock: startedAt is the future absolute moment input unlocks.
    if (startedAt !== null && Date.now() < startedAt) return;
    const cell = board.cells[selected];
    if (!cell || cell.given !== null) return;

    const move: Move = notesMode
      ? { kind: 'note_toggle', cell: selected, value }
      : { kind: 'value', cell: selected, value };

    const result = applyMoveWithHistory(board, history, move);
    if (result.state === board) return;
    set({
      board: result.state,
      history: result.history,
      conflicts: recomputeConflicts(result.state, settings.showConflicts),
    });

    const res = await submitMove({
      room_id: room.room_id,
      cell: move.cell,
      kind: move.kind,
      value: move.kind === 'value' || move.kind === 'note_toggle' ? value : null,
    });
    if (!res.ok) {
      set({ lastError: res.error.message });
      return;
    }
    // Update incorrect set from server's autoCheck verdict.
    const inc = new Set(get().incorrect);
    if (res.value.cell_correct === true) inc.delete(move.cell);
    if (res.value.cell_correct === false) inc.add(move.cell);
    set({
      ownProgressPct: res.value.progress_pct,
      incorrect: inc,
      lastError: null,
    });
    if (res.value.won) {
      set({ finishedAt: Date.now() });
    }
  },

  clearCell: async () => {
    const { board, selected, history, room, settings, finishedAt, startedAt } = get();
    if (!board || !room || selected === null || finishedAt !== null) return;
    if (startedAt !== null && Date.now() < startedAt) return;
    const result = applyMoveWithHistory(board, history, { kind: 'clear', cell: selected });
    if (result.state === board) return;
    set({
      board: result.state,
      history: result.history,
      conflicts: recomputeConflicts(result.state, settings.showConflicts),
    });

    const res = await submitMove({
      room_id: room.room_id,
      cell: selected,
      kind: 'clear',
      value: null,
    });
    if (!res.ok) {
      set({ lastError: res.error.message });
      return;
    }
    // Cleared cells can no longer be "wrong".
    const inc = new Set(get().incorrect);
    inc.delete(selected);
    set({ ownProgressPct: res.value.progress_pct, incorrect: inc, lastError: null });
  },

  undo: () => {
    const { board, history, settings } = get();
    if (!board || !canUndo(history)) return;
    const result = undoHistory(board, history);
    set({
      board: result.state,
      history: result.history,
      conflicts: recomputeConflicts(result.state, settings.showConflicts),
    });
    // Note: undo is local-only — we don't send a server clear for V1. The
    // server's progress_pct will drift from the client's until the next
    // move. That's acceptable for the typical "I miss-typed, let me undo"
    // case; the next legitimate enterValue will resync.
  },

  redo: () => {
    const { board, history, settings } = get();
    if (!board || !canRedo(history)) return;
    const result = redoHistory(board, history);
    set({
      board: result.state,
      history: result.history,
      conflicts: recomputeConflicts(result.state, settings.showConflicts),
    });
  },

  markFinished: () => {
    if (get().finishedAt === null) set({ finishedAt: Date.now() });
  },
}));

export function selectBattleCanUndo(s: BattleState): boolean {
  return canUndo(s.history);
}
export function selectBattleCanRedo(s: BattleState): boolean {
  return canRedo(s.history);
}
