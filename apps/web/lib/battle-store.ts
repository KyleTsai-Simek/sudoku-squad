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
  fetchOwnMoves,
  DEFAULT_ROOM_SETTINGS,
  type RoomSettings,
  type RoomState,
  type ServerMove,
} from './rooms';
import { enqueueMove } from './move-batcher';

/**
 * Battle-mode local state. Each player has a private board.
 *
 * Sync model (rewrite — see DECISIONS #0036):
 *   - Every submit carries a client-generated `client_move_id` (uuid). The
 *     server uses it for idempotent retries — a dropped HTTP response no
 *     longer creates duplicate moves.
 *   - Submits fire in parallel. The old global serial queue is gone now that
 *     the server assigns seqs atomically via `rooms.next_seq`, removing the
 *     contention that motivated the queue.
 *   - On submit failure, we resync from the server: fetch every move we've
 *     made and re-materialize the board. This closes the divergence-on-error
 *     hole called out by the CLAUDE.md rule "if server rejects, roll back."
 *     The user sees their failed entry disappear with a toast.
 *
 * No `solution` is ever fetched client-side here — battle uses Edge Functions
 * for any correctness signal (autoCheck's `cell_correct`).
 */

interface PendingMove {
  cid: string;
  cell: CellIndex;
}

interface BattleState {
  room: RoomState | null;
  puzzleCode: PuzzleCode | null;
  /** The givens for the puzzle. Held so we can re-materialize on resync
   *  without needing to refetch puzzles_public. */
  givens: number[] | null;
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
  /** In-flight submits — used for diagnostics and for ignoring our own
   *  realtime echoes if we ever subscribe to battle moves in the future. */
  pending: PendingMove[];

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
  /** One-shot pencil-mark toggle, regardless of notesMode. Wired to Shift+digit. */
  enterNote: (value: CellValue) => Promise<void>;
  clearCell: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  markFinished: () => void;
}

function recomputeConflicts(board: BoardState, on: boolean): Set<CellIndex> {
  return on ? findConflicts(board) : new Set<CellIndex>();
}

function newCid(): string {
  // crypto.randomUUID is available in all evergreen browsers + Node 16+.
  // The store only runs in the browser ('use client'), so this is safe.
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Convert a ServerMove to the local Move shape understood by the core
 *  reducer. Returns null for moves we can't apply. */
function toCoreMove(m: ServerMove): Move | null {
  if (m.kind === 'clear') return { kind: 'clear', cell: m.cell };
  if (m.value === null) return null;
  if (m.value < 1 || m.value > 9) return null;
  return { kind: m.kind, cell: m.cell, value: m.value as CellValue };
}

/** Re-materialize the player's board from the server's authoritative move
 *  log. Used on submit failure to recover. Resets local history. */
async function resyncFromServer(get: () => BattleState, set: (s: Partial<BattleState>) => void): Promise<void> {
  const { room, puzzleCode, givens, settings } = get();
  if (!room || !puzzleCode || !givens) return;
  const moves = await fetchOwnMoves(room.room_id, room.own_player_id);
  let board = createBoard(puzzleCode, givens);
  for (const sm of moves) {
    const core = toCoreMove(sm);
    if (core) board = applyMove(board, core);
  }
  set({
    board,
    history: createHistory(),
    conflicts: recomputeConflicts(board, settings.showConflicts),
    incorrect: new Set(),
    pending: [],
  });
}

export const useBattleStore = create<BattleState>((set, get) => ({
  room: null,
  puzzleCode: null,
  givens: null,
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
  pending: [],

  startBattle: (room, puzzleCode, givens, settings, gameStartsAt) => {
    const board = createBoard(puzzleCode, givens);
    set({
      room,
      puzzleCode,
      givens,
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
      pending: [],
    });
  },

  applySettings: (settings) => {
    const { board } = get();
    set({
      settings,
      conflicts: board ? recomputeConflicts(board, settings.showConflicts) : new Set(),
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
    const { board, selected, room, notesMode, finishedAt, startedAt } = get();
    if (!board || !room || selected === null || finishedAt !== null) return;
    if (startedAt !== null && Date.now() < startedAt) return;
    const cell = board.cells[selected];
    if (!cell || cell.given !== null) return;

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
    const cid = newCid();
    set({
      board: result.state,
      history: result.history,
      conflicts: recomputeConflicts(result.state, settings.showConflicts),
      pending: [...get().pending, { cid, cell: selected }],
    });

    const res = await enqueueMove(room.room_id, {
      cell: move.cell,
      kind: move.kind,
      value: move.kind === 'value' || move.kind === 'note_toggle' ? value : null,
      client_move_id: cid,
    });

    // Always drop the pending entry — success or failure resolves it.
    set({ pending: get().pending.filter((p) => p.cid !== cid) });

    if (!res.ok) {
      set({ lastError: res.error.message });
      await resyncFromServer(get, set);
      return;
    }
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

  enterNote: async (value) => {
    const { board, selected, history, room, settings, finishedAt, startedAt } = get();
    if (!board || !room || selected === null || finishedAt !== null) return;
    if (startedAt !== null && Date.now() < startedAt) return;
    const cell = board.cells[selected];
    if (!cell || cell.given !== null || cell.value !== null) return;
    const move: Move = { kind: 'note_toggle', cell: selected, value };
    const result = applyMoveWithHistory(board, history, move);
    if (result.state === board) return;
    const cid = newCid();
    set({
      board: result.state,
      history: result.history,
      conflicts: recomputeConflicts(result.state, settings.showConflicts),
      pending: [...get().pending, { cid, cell: selected }],
    });
    const res = await enqueueMove(room.room_id, {
      cell: selected,
      kind: 'note_toggle',
      value,
      client_move_id: cid,
    });
    set({ pending: get().pending.filter((p) => p.cid !== cid) });
    if (!res.ok) {
      set({ lastError: res.error.message });
      await resyncFromServer(get, set);
      return;
    }
    set({ ownProgressPct: res.value.progress_pct, lastError: null });
  },

  clearCell: async () => {
    const { board, selected, history, room, settings, finishedAt, startedAt } = get();
    if (!board || !room || selected === null || finishedAt !== null) return;
    if (startedAt !== null && Date.now() < startedAt) return;
    const cell = board.cells[selected];
    if (!cell || cell.given !== null) return;

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

    const cid = newCid();
    set({ pending: [...get().pending, { cid, cell: selected }] });

    const res = await enqueueMove(room.room_id, {
      cell: selected,
      kind: 'clear',
      value: null,
      client_move_id: cid,
    });
    set({ pending: get().pending.filter((p) => p.cid !== cid) });
    if (!res.ok) {
      set({ lastError: res.error.message });
      await resyncFromServer(get, set);
      return;
    }
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
    // Battle keeps undo local-only on purpose: the server still has the
    // original move in the log, and progress_pct will drift until the next
    // legitimate enterValue resyncs it. Acceptable for battle because the
    // board is private — no other player sees the un-undone value.
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
