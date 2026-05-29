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
  movesToReach,
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
    initialMoves: ServerMove[],
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
  undo: () => Promise<void>;
  redo: () => Promise<void>;
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

/** Materialize the player's private board from givens + their own server
 *  moves, applied in seq order. Pure. */
function materializeOwnBoard(
  puzzleCode: PuzzleCode,
  givens: number[],
  moves: ServerMove[],
): BoardState {
  let board = createBoard(puzzleCode, givens);
  for (const sm of moves) {
    const core = toCoreMove(sm);
    if (core) board = applyMove(board, core);
  }
  return board;
}

/** Progress = filled non-given cells / total non-given cells, as a 0–100
 *  integer. Mirrors the server's `materialize` (submit-move/index.ts) so a
 *  board reconstructed from the log shows the same number the server cached —
 *  no solution needed, since progress is fill-based not correctness-based. */
function computeProgressPct(board: BoardState): number {
  let filled = 0;
  let total = 0;
  for (const cell of board.cells) {
    if (cell.given !== null) continue;
    total++;
    if (cell.value !== null) filled++;
  }
  return total === 0 ? 100 : Math.round((filled / total) * 100);
}

/** Re-materialize the player's board from the server's authoritative move
 *  log. Used on submit failure to recover. Resets local history. */
async function resyncFromServer(get: () => BattleState, set: (s: Partial<BattleState>) => void): Promise<void> {
  const { room, puzzleCode, givens, settings } = get();
  if (!room || !puzzleCode || !givens) return;
  const moves = await fetchOwnMoves(room.room_id, room.own_player_id);
  const board = materializeOwnBoard(puzzleCode, givens, moves);
  set({
    board,
    history: createHistory(),
    conflicts: recomputeConflicts(board, settings.showConflicts),
    incorrect: new Set(),
    ownProgressPct: computeProgressPct(board),
    pending: [],
  });
}

/** Submit the compensating moves for an undo/redo/smart-clear and reconcile
 *  the result exactly like typed entries: update progress, autocheck flags, and
 *  win. An undo can't be expressed as a single inverse move — restoring a
 *  value's auto-cleared peer notes (and the target's own prior notes) takes a
 *  faithful batch from `movesToReach`. Emitting them as real moves keeps the
 *  server's authoritative log (and every replay of it) in sync with what the
 *  player sees locally — closing the notes-divergence hole. See DECISIONS #0041
 *  (supersedes the single-move approach from #0039).
 *
 *  Order within the batch is preserved by the per-room batcher, so the server
 *  assigns monotonic seqs in the clear→value→note order `movesToReach` emits. */
async function submitCompensatingMoves(
  get: () => BattleState,
  set: (s: Partial<BattleState>) => void,
  moves: Move[],
): Promise<void> {
  const { room } = get();
  if (!room || moves.length === 0) return;
  const entries = moves.map((move) => ({ move, cid: newCid() }));
  set({ pending: [...get().pending, ...entries.map((e) => ({ cid: e.cid, cell: e.move.cell }))] });
  const results = await Promise.all(
    entries.map((e) =>
      enqueueMove(room.room_id, {
        cell: e.move.cell,
        kind: e.move.kind,
        value: e.move.kind === 'clear' ? null : e.move.value,
        client_move_id: e.cid,
      }).then((res) => ({ entry: e, res })),
    ),
  );
  const cids = new Set(entries.map((e) => e.cid));
  set({ pending: get().pending.filter((p) => !cids.has(p.cid)) });

  const failure = results.find((r) => !r.res.ok);
  if (failure && !failure.res.ok) {
    set({ lastError: failure.res.error.message });
    await resyncFromServer(get, set);
    return;
  }

  // Reconcile autocheck per move; take progress/win from the last (highest-seq)
  // result, which reflects the board after the whole batch landed.
  const inc = new Set(get().incorrect);
  for (const { entry, res } of results) {
    if (!res.ok) continue;
    const { move } = entry;
    if (move.kind === 'clear') inc.delete(move.cell);
    else if (move.kind === 'value') {
      if (res.value.cell_correct === true) inc.delete(move.cell);
      else if (res.value.cell_correct === false) inc.add(move.cell);
    }
  }
  const last = results[results.length - 1];
  if (last && last.res.ok) {
    set({ ownProgressPct: last.res.value.progress_pct, incorrect: inc, lastError: null });
    if (last.res.value.won) set({ finishedAt: Date.now() });
  } else {
    set({ incorrect: inc, lastError: null });
  }
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

  startBattle: (room, puzzleCode, givens, settings, gameStartsAt, initialMoves) => {
    // Materialize from the player's own server-confirmed log so a mid-battle
    // reload shows their progress immediately, rather than an empty board that
    // only refills on the next submit's resync. The log is private per player
    // (battle boards aren't shared), so `fetchOwnMoves` is the right source.
    const board = materializeOwnBoard(puzzleCode, givens, initialMoves);
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
      ownProgressPct: computeProgressPct(board),
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

    // Smart-clear: re-clearing the value you just placed undoes the placement
    // (restoring auto-cleaned peer notes) rather than doing a destructive
    // clear. Either way we drive the board to the target state and emit the
    // faithful move batch so the server log matches. See DECISIONS #0041.
    const last = peekLastMove(history);
    const isSmartUndo =
      !!last &&
      last.kind === 'value' &&
      last.cell === selected &&
      cell.value === last.value;

    const result = isSmartUndo
      ? undoHistory(board, history)
      : applyMoveWithHistory(board, history, { kind: 'clear', cell: selected });
    if (result.state === board) return;
    const compensating = movesToReach(board, result.state);
    set({
      board: result.state,
      history: result.history,
      conflicts: recomputeConflicts(result.state, settings.showConflicts),
    });
    await submitCompensatingMoves(get, set, compensating);
  },

  undo: async () => {
    // Battle undo emits a faithful batch of server moves (via movesToReach) so
    // the server's authoritative log — and every replay of it — reflects the
    // exact reverted board, notes included. The board is private so peers never
    // see it, but progress_pct and the on-resync materialization both depend on
    // the log being right. See DECISIONS #0041 (supersedes #0039).
    const { board, room, history, settings } = get();
    if (!board || !room || !canUndo(history)) return;
    const result = undoHistory(board, history);
    const compensating = movesToReach(board, result.state);
    set({
      board: result.state,
      history: result.history,
      conflicts: recomputeConflicts(result.state, settings.showConflicts),
    });
    await submitCompensatingMoves(get, set, compensating);
  },

  redo: async () => {
    // Symmetric to undo: re-apply the redone move locally, then emit the moves
    // that reproduce the resulting board on the server.
    const { board, room, history, settings } = get();
    if (!board || !room || !canRedo(history)) return;
    const result = redoHistory(board, history);
    if (result.state === board) {
      // Orphaned redo entry (the cell diverged) — redoHistory drops it; keep
      // our history in sync and bail.
      set({ history: result.history });
      return;
    }
    const compensating = movesToReach(board, result.state);
    set({
      board: result.state,
      history: result.history,
      conflicts: recomputeConflicts(result.state, settings.showConflicts),
    });
    await submitCompensatingMoves(get, set, compensating);
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
