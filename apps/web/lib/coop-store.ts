'use client';

import { create } from 'zustand';
import {
  applyMove,
  applyMoveWithHistory,
  canRedo,
  canUndo,
  createBoard,
  createHistory,
  findConflicts,
  peekLastMove,
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
  type ServerMove,
} from './rooms';
import { enqueueSubmit } from './submit-queue';

/**
 * Coop-mode local state. Like battle-store.ts but the board is **shared** —
 * every player writes to the same board, and the server materializes via
 * LWW per cell by `seq`. Differences from battle-store:
 *
 *   - `applyRemoteMove` folds in other players' moves as they arrive via
 *     the moves realtime channel.
 *   - `pendingOwnSeqs` dedupes server echos of moves we already applied
 *     locally (optimistic apply).
 *   - No `incorrect` set yet (autoCheck wiring is the same as battle but
 *     simpler — we trust the server's per-move response).
 *   - No `winner_player_id` distinction: a coop win is a SHARED win
 *     announced via `rooms.status='finished'`, and the UI shows
 *     "Solved together!" instead of a per-player win/lose state.
 *
 * Per the Plan agent's spec, this is duplicated from battle-store rather
 * than extracted — the two shapes diverge meaningfully and a parameterized
 * version would be noisier. Refactor candidate post-Phase-3.
 */

interface CoopState {
  room: RoomState | null;
  puzzleCode: PuzzleCode | null;
  board: BoardState | null;
  history: MoveHistory;
  selected: CellIndex | null;
  notesMode: boolean;
  settings: RoomSettings;
  conflicts: Set<CellIndex>;
  startedAt: number | null;
  finishedAt: number | null;
  sharedProgressPct: number;
  lastError: string | null;
  /** Seqs we've submitted ourselves; suppresses double-apply when the server
   *  echoes them via the realtime channel. */
  pendingOwnSeqs: Set<number>;

  // actions
  startCoop: (
    room: RoomState,
    puzzleCode: PuzzleCode,
    givens: number[],
    settings: RoomSettings,
    gameStartsAt: number,
    initialMoves: ServerMove[],
  ) => void;
  applySettings: (settings: RoomSettings) => void;
  selectCell: (cell: CellIndex | null) => void;
  moveSelection: (dx: number, dy: number) => void;
  toggleNotesMode: () => void;
  setNotesMode: (on: boolean) => void;
  enterValue: (value: CellValue) => Promise<void>;
  enterNote: (value: CellValue) => Promise<void>;
  clearCell: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  /** Apply a move from another player (or our own echo). Suppressed when seq
   *  is already in pendingOwnSeqs. */
  applyRemoteMove: (m: ServerMove) => void;
  markFinished: () => void;
}

function recomputeConflicts(board: BoardState, on: boolean): Set<CellIndex> {
  return on ? findConflicts(board) : new Set<CellIndex>();
}

/** Convert a ServerMove into the local Move shape understood by the
 *  packages/core reducer. Returns null for moves that can't be applied
 *  (e.g., a value move with a null value, which the server validates against
 *  but we double-check). */
function toCoreMove(m: ServerMove): Move | null {
  if (m.kind === 'clear') return { kind: 'clear', cell: m.cell };
  if (m.value === null) return null;
  if (m.value < 1 || m.value > 9) return null;
  return { kind: m.kind, cell: m.cell, value: m.value as CellValue };
}

export const useCoopStore = create<CoopState>((set, get) => ({
  room: null,
  puzzleCode: null,
  board: null,
  history: createHistory(),
  selected: null,
  notesMode: false,
  settings: { ...DEFAULT_ROOM_SETTINGS },
  conflicts: new Set(),
  startedAt: null,
  finishedAt: null,
  sharedProgressPct: 0,
  lastError: null,
  pendingOwnSeqs: new Set(),

  startCoop: (room, puzzleCode, givens, settings, gameStartsAt, initialMoves) => {
    // Build base board, then fold in every move that's already been made in
    // the room (replay path — covers both fresh-start with 0 moves and
    // late-joiner with N moves). LWW falls out of replaying in seq order.
    let board = createBoard(puzzleCode, givens);
    for (const sm of initialMoves) {
      const core = toCoreMove(sm);
      if (core) board = applyMove(board, core);
    }
    set({
      room,
      puzzleCode,
      board,
      history: createHistory(),
      selected: null,
      notesMode: false,
      settings,
      conflicts: recomputeConflicts(board, settings.showConflicts),
      startedAt: gameStartsAt,
      finishedAt: null,
      sharedProgressPct: 0,
      lastError: null,
      pendingOwnSeqs: new Set(),
    });
  },

  applySettings: (settings) => {
    const { board } = get();
    set({
      settings,
      conflicts: board ? recomputeConflicts(board, settings.showConflicts) : new Set(),
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
    const { board, selected, room, notesMode, finishedAt, startedAt } = get();
    if (!board || !room || selected === null || finishedAt !== null) return;
    if (startedAt !== null && Date.now() < startedAt) return;
    const cell = board.cells[selected];
    if (!cell || cell.given !== null) return;

    // Re-typing the placed value acts as a clear (same UX as SP / battle).
    if (!notesMode && cell.value === value) {
      await get().clearCell();
      return;
    }

    const { history, settings } = get();
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

    const res = await enqueueSubmit(() =>
      submitMove({
        room_id: room.room_id,
        cell: move.cell,
        kind: move.kind,
        value: move.kind === 'value' || move.kind === 'note_toggle' ? value : null,
      }),
    );
    if (!res.ok) {
      set({ lastError: res.error.message });
      return;
    }
    // Mark this seq as ours so the realtime echo doesn't double-apply.
    if (res.value.seq !== undefined) {
      const next = new Set(get().pendingOwnSeqs);
      next.add(res.value.seq);
      set({ pendingOwnSeqs: next });
    }
    set({
      sharedProgressPct: res.value.progress_pct,
      lastError: null,
    });
    if (res.value.won) {
      set({ finishedAt: Date.now() });
    }
  },

  enterNote: async (value) => {
    const { board, selected, room, finishedAt, startedAt } = get();
    if (!board || !room || selected === null || finishedAt !== null) return;
    if (startedAt !== null && Date.now() < startedAt) return;
    const cell = board.cells[selected];
    if (!cell || cell.given !== null || cell.value !== null) return;
    const move: Move = { kind: 'note_toggle', cell: selected, value };
    const { history, settings } = get();
    const result = applyMoveWithHistory(board, history, move);
    if (result.state === board) return;
    set({
      board: result.state,
      history: result.history,
      conflicts: recomputeConflicts(result.state, settings.showConflicts),
    });
    const res = await enqueueSubmit(() =>
      submitMove({
        room_id: room.room_id,
        cell: selected,
        kind: 'note_toggle',
        value,
      }),
    );
    if (!res.ok) {
      set({ lastError: res.error.message });
      return;
    }
    if (res.value.seq !== undefined) {
      const next = new Set(get().pendingOwnSeqs);
      next.add(res.value.seq);
      set({ pendingOwnSeqs: next });
    }
    set({ sharedProgressPct: res.value.progress_pct, lastError: null });
  },

  clearCell: async () => {
    const { board, selected, history, room, settings, finishedAt, startedAt } = get();
    if (!board || !room || selected === null || finishedAt !== null) return;
    if (startedAt !== null && Date.now() < startedAt) return;
    const cell = board.cells[selected];
    if (!cell || cell.given !== null) return;

    // Smart-clear: matches battle/SP. Note: in coop the "just-placed" move
    // might be another player's; we only smart-undo when peekLastMove says
    // our local history's top frame was a value move on this cell. Safe
    // because our local history is per-player and never sees others' moves.
    const last = peekLastMove(history);
    const isSmartUndo =
      !!last &&
      last.kind === 'value' &&
      last.cell === selected &&
      cell.value === last.value;

    if (isSmartUndo) {
      const undone = undoHistory(board, history);
      set({
        board: undone.state,
        history: undone.history,
        conflicts: recomputeConflicts(undone.state, settings.showConflicts),
      });
    } else {
      const result = applyMoveWithHistory(board, history, { kind: 'clear', cell: selected });
      if (result.state === board) return;
      set({
        board: result.state,
        history: result.history,
        conflicts: recomputeConflicts(result.state, settings.showConflicts),
      });
    }

    const res = await enqueueSubmit(() =>
      submitMove({
        room_id: room.room_id,
        cell: selected,
        kind: 'clear',
        value: null,
      }),
    );
    if (!res.ok) {
      set({ lastError: res.error.message });
      return;
    }
    if (res.value.seq !== undefined) {
      const next = new Set(get().pendingOwnSeqs);
      next.add(res.value.seq);
      set({ pendingOwnSeqs: next });
    }
    set({ sharedProgressPct: res.value.progress_pct, lastError: null });
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
    // V1: undo is local-only — server still has the move. Acceptable for
    // typo-fix UX; coop late-finish-style desync is rare and resolved on
    // the next legitimate enterValue.
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

  applyRemoteMove: (m) => {
    const { board, pendingOwnSeqs, settings } = get();
    if (!board) return;
    // Echo suppression — we already applied this seq locally on submit.
    if (pendingOwnSeqs.has(m.seq)) {
      const next = new Set(pendingOwnSeqs);
      next.delete(m.seq);
      set({ pendingOwnSeqs: next });
      return;
    }
    const core = toCoreMove(m);
    if (!core) return;
    const nextBoard = applyMove(board, core);
    if (nextBoard === board) return;
    set({
      board: nextBoard,
      conflicts: recomputeConflicts(nextBoard, settings.showConflicts),
    });
  },

  markFinished: () => {
    if (get().finishedAt === null) set({ finishedAt: Date.now() });
  },
}));

export function selectCoopCanUndo(s: CoopState): boolean {
  return canUndo(s.history);
}
export function selectCoopCanRedo(s: CoopState): boolean {
  return canRedo(s.history);
}
