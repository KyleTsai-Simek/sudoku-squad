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
 *     the moves realtime channel. Own echoes are dropped by player_id
 *     (race-free; doesn't depend on the submit-move HTTP response landing
 *     before the realtime broadcast).
 *   - `appliedSeqs` catches duplicate realtime delivery (rare; happens
 *     during reconnects).
 *   - `pendingRemote` buffers realtime events during the
 *     fetch-then-subscribe window so a move landing mid-replay is
 *     applied in seq order rather than dropped on the floor.
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
  /** Seqs already folded into the local board — from the initial replay,
   *  from realtime, or from our own optimistic apply. Catches duplicate
   *  realtime delivery (Supabase Realtime occasionally double-delivers
   *  during reconnects) and the late-join drain. */
  appliedSeqs: Set<number>;
  /** Realtime events that arrived before `startCoop` ran. Drained in seq
   *  order at the end of startCoop. Without this buffer, a move landing
   *  mid-replay is silently dropped on the floor. */
  pendingRemote: ServerMove[];

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
  /** Apply a move from the realtime `moves` channel. Skips when the move
   *  is ours (we already applied it optimistically — dedup by player_id,
   *  which is known instantly and doesn't race the seq round-trip) or when
   *  we've already applied that seq. Buffers when no board yet. */
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
  appliedSeqs: new Set(),
  pendingRemote: [],

  startCoop: (room, puzzleCode, givens, settings, gameStartsAt, initialMoves) => {
    // Build base board + fold in every move already in the room. LWW falls
    // out of replaying in seq order. Record every applied seq so a re-
    // delivery via realtime is a no-op.
    let board = createBoard(puzzleCode, givens);
    const applied = new Set<number>();
    for (const sm of initialMoves) {
      const core = toCoreMove(sm);
      if (core) {
        board = applyMove(board, core);
        applied.add(sm.seq);
      }
    }

    // Drain any realtime events that arrived during the fetch window. We
    // skip our own (already applied optimistically — though for a fresh
    // joiner there shouldn't be any) and already-applied seqs.
    const pending = get().pendingRemote;
    for (const m of pending) {
      if (m.player_id === room.own_player_id) continue;
      if (applied.has(m.seq)) continue;
      const core = toCoreMove(m);
      if (core) {
        board = applyMove(board, core);
        applied.add(m.seq);
      }
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
      appliedSeqs: applied,
      pendingRemote: [],
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
    // Record the seq so realtime double-delivery is a no-op. The PRIMARY
    // dedup is by player_id (in applyRemoteMove) — this is belt + suspenders.
    if (res.value.seq !== undefined) {
      const next = new Set(get().appliedSeqs);
      next.add(res.value.seq);
      set({ appliedSeqs: next });
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
      const next = new Set(get().appliedSeqs);
      next.add(res.value.seq);
      set({ appliedSeqs: next });
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
      const next = new Set(get().appliedSeqs);
      next.add(res.value.seq);
      set({ appliedSeqs: next });
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
    const { board, room, appliedSeqs, pendingRemote, settings } = get();

    // If the local board hasn't been laid down yet (startCoop hasn't run),
    // buffer the event so it can be drained in seq order once the replay
    // completes. Without this, a move landing in the fetch-then-subscribe
    // window is silently dropped.
    if (!board || !room) {
      // Cheap dedup vs. duplicate realtime delivery during reconnects.
      if (pendingRemote.some((p) => p.seq === m.seq)) return;
      set({ pendingRemote: [...pendingRemote, m] });
      return;
    }

    // Primary dedup: our own optimistic apply already moved the board.
    // Filter by player_id — known instantly, no race with the seq round-trip.
    if (m.player_id === room.own_player_id) {
      // Record the seq so a subsequent re-delivery (rare) is also a no-op.
      if (!appliedSeqs.has(m.seq)) {
        const next = new Set(appliedSeqs);
        next.add(m.seq);
        set({ appliedSeqs: next });
      }
      return;
    }

    // Belt + suspenders: drop seqs we've already folded in.
    if (appliedSeqs.has(m.seq)) return;

    const core = toCoreMove(m);
    if (!core) return;
    const nextBoard = applyMove(board, core);
    const nextApplied = new Set(appliedSeqs);
    nextApplied.add(m.seq);
    if (nextBoard === board) {
      // No-op (e.g., note_toggle on a cell whose mask already reflected this
      // bit — shouldn't happen given LWW/XOR, but stays consistent).
      set({ appliedSeqs: nextApplied });
      return;
    }
    set({
      board: nextBoard,
      conflicts: recomputeConflicts(nextBoard, settings.showConflicts),
      appliedSeqs: nextApplied,
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
