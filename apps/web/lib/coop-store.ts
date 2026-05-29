'use client';

import { create } from 'zustand';
import {
  applyMove,
  applyMoves,
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
  Cell,
  CellIndex,
  CellValue,
  Move,
  MoveHistory,
  PuzzleCode,
} from '@sudoku-squad/core';
import {
  fetchAllMoves,
  DEFAULT_ROOM_SETTINGS,
  type RoomSettings,
  type RoomState,
  type ServerMove,
} from './rooms';
import { enqueueMove } from './move-batcher';

/**
 * Coop-mode local state. All players share a single board; the server
 * orders writes via `seq` and the displayed board is materialized as:
 *
 *     givens
 *     + every server-confirmed move applied in seq order  (remoteBoard)
 *     + every still-in-flight own move overlaid on top    (board)
 *
 * This shape replaces the old "apply optimistically + dedup-by-player_id"
 * pattern, which had a real divergence bug: when two players raced to the
 * same cell, one client could permanently see the *earlier* (lower-seq)
 * move because its own higher-seq move had already optimistically applied
 * before the lower-seq remote move arrived. With the new model, every
 * realtime move re-materializes the board from the seq-sorted log, so the
 * outcome is always LWW-by-seq regardless of arrival order.
 *
 * Dedup is now by `client_move_id` (set per-submit by us, broadcast via the
 * realtime row), which uniquely identifies a move across all clients. Our
 * own optimistic pendings drop out of the overlay when the server's echo
 * shows up.
 *
 * On submit failure: resync — refetch the full move log, rebuild
 * remoteBoard, drop the failed pending. Surfaces as a brief flicker for the
 * failed cell.
 */

interface PendingMove {
  cid: string;
  move: Move;
  submittedAt: number;
}

interface CoopState {
  room: RoomState | null;
  puzzleCode: PuzzleCode | null;
  givens: number[] | null;
  /** Server-confirmed moves keyed by seq. The board is rematerialized from
   *  this Map every time it changes. */
  serverMoves: Map<number, ServerMove>;
  /** Our own moves that haven't been confirmed by the server yet. Overlaid
   *  on top of remoteBoard to produce the displayed board. */
  pendings: PendingMove[];
  /** Board with server-confirmed moves applied in seq order. */
  remoteBoard: BoardState | null;
  /** Board with server-confirmed moves + our pendings overlaid. This is
   *  what the UI renders. */
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
  /** Realtime events that arrived before `startCoop` ran (or before the
   *  initial fetch+subscribe handshake finished). Drained into serverMoves
   *  at the end of startCoop in seq order. */
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
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  /** Apply a move from the realtime `moves` channel. Dedups by seq (already
   *  applied) and by client_move_id (our own optimistic move's echo). */
  applyRemoteMove: (m: ServerMove) => void;
  /** Refetch the entire move log and rebuild remoteBoard. Used as the
   *  recovery path on submit failure and as a defensive resync if we
   *  suspect divergence. */
  resync: () => Promise<void>;
  markFinished: () => void;
}

function recomputeConflicts(board: BoardState, on: boolean): Set<CellIndex> {
  return on ? findConflicts(board) : new Set<CellIndex>();
}

function newCid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Gap detection: if our serverMoves contains seqs with holes (e.g., 1, 2,
 * 4 but not 3), postgres_changes likely dropped or delayed event 3. We
 * wait briefly to give realtime time to deliver out-of-order events, then
 * refetch if the gap persists.
 *
 * Module-level state because this is per-room and the coop store has only
 * one active room at a time per browser tab.
 */
let gapResyncTimer: ReturnType<typeof setTimeout> | null = null;
const GAP_RESYNC_DEBOUNCE_MS = 500;

/**
 * Seqs that are permanently absent from the server's authoritative log and
 * must NOT be treated as dropped realtime events. They arise when
 * submit-move's 23505 dup-race path reserves a fresh seq block and abandons
 * the original reservation — those reserved-but-unused seqs leave permanent
 * holes. Without this, `hasSeqGap` would see the hole forever and refetch the
 * whole log on every subsequent move (a resync storm).
 *
 * Recomputed from scratch on every authoritative refetch (startCoop /
 * resync): a hole still present right after a full server fetch is, by
 * definition, abandoned rather than dropped. This makes the set self-healing
 * — a seq mistakenly marked here (e.g. one that committed just after our
 * SELECT snapshot) is dropped from the set at the next resync once the fetch
 * sees it. Module-level for the same reason as gapResyncTimer: one active
 * room per tab.
 */
let knownMissingSeqs = new Set<number>();

/** Holes in [1, max] absent from an authoritative server snapshot. */
function computeAbandonedHoles(serverMoves: Map<number, ServerMove>): Set<number> {
  const holes = new Set<number>();
  const seqs = [...serverMoves.keys()];
  if (seqs.length === 0) return holes;
  const max = Math.max(...seqs);
  for (let s = 1; s <= max; s++) {
    if (!serverMoves.has(s)) holes.add(s);
  }
  return holes;
}

function hasSeqGap(serverMoves: Map<number, ServerMove>): boolean {
  const seqs = [...serverMoves.keys()];
  if (seqs.length === 0) return false;
  const max = Math.max(...seqs);
  // A gap is any seq in [1, max] (start-game resets the counter to 1) that we
  // neither hold nor know to be a permanently-abandoned reservation.
  for (let s = 1; s <= max; s++) {
    if (!serverMoves.has(s) && !knownMissingSeqs.has(s)) return true;
  }
  return false;
}

function scheduleGapResync(resync: () => void): void {
  if (gapResyncTimer !== null) return; // already scheduled
  gapResyncTimer = setTimeout(() => {
    gapResyncTimer = null;
    resync();
  }, GAP_RESYNC_DEBOUNCE_MS);
}

function cancelGapResync(): void {
  if (gapResyncTimer !== null) {
    clearTimeout(gapResyncTimer);
    gapResyncTimer = null;
  }
}

function toCoreMove(m: ServerMove | { kind: Move['kind']; cell: number; value: number | null }): Move | null {
  if (m.kind === 'clear') return { kind: 'clear', cell: m.cell };
  if (m.value === null) return null;
  if (m.value < 1 || m.value > 9) return null;
  return { kind: m.kind, cell: m.cell, value: m.value as CellValue };
}

/** Materialize a board from givens + server moves in seq order. Pure. */
function materializeRemote(
  puzzleCode: PuzzleCode,
  givens: number[],
  serverMoves: Map<number, ServerMove>,
): BoardState {
  let board = createBoard(puzzleCode, givens);
  const sortedSeqs = [...serverMoves.keys()].sort((a, b) => a - b);
  for (const seq of sortedSeqs) {
    const m = serverMoves.get(seq)!;
    const core = toCoreMove(m);
    if (core) board = applyMove(board, core);
  }
  return board;
}

/**
 * Walk the seq-ordered move log and compute who currently "owns" each cell.
 * Ownership rules:
 *   - 'value' move sets ownership to that move's player_id (LAST writer wins).
 *   - 'clear' removes ownership.
 *   - 'note_toggle' does NOT change ownership (notes aren't a cell value).
 * Returns a Map of player_id → count of cells they own.
 *
 * Pendings (our own unconfirmed moves) are folded in at the end and
 * attributed to `ownPlayerId`. This gives instant credit on the placing
 * client — without it, we'd wait on the realtime echo round-trip and the
 * UI would lag a noticeable beat behind the cell-fill animation.
 */
export function computeOwnership(
  serverMoves: Map<number, ServerMove>,
  pendings: Array<{ move: Move }>,
  ownPlayerId: string | null,
): Map<string, number> {
  const cellOwner = new Map<number, string>();
  const sortedSeqs = [...serverMoves.keys()].sort((a, b) => a - b);
  for (const seq of sortedSeqs) {
    const m = serverMoves.get(seq)!;
    if (m.kind === 'value') {
      cellOwner.set(m.cell, m.player_id);
    } else if (m.kind === 'clear') {
      cellOwner.delete(m.cell);
    }
    // note_toggle: skip
  }
  // Pendings are applied AFTER server moves (they happen-after by definition;
  // their server seq, when it lands, will be > any current serverMoves seq).
  if (ownPlayerId) {
    for (const p of pendings) {
      if (p.move.kind === 'value') {
        cellOwner.set(p.move.cell, ownPlayerId);
      } else if (p.move.kind === 'clear') {
        cellOwner.delete(p.move.cell);
      }
    }
  }
  const counts = new Map<string, number>();
  for (const owner of cellOwner.values()) {
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return counts;
}

/** Overlay pending moves on top of remoteBoard. */
function overlayPendings(remoteBoard: BoardState, pendings: PendingMove[]): BoardState {
  return applyMoves(remoteBoard, pendings.map((p) => p.move));
}

export const useCoopStore = create<CoopState>((set, get) => ({
  room: null,
  puzzleCode: null,
  givens: null,
  serverMoves: new Map(),
  pendings: [],
  remoteBoard: null,
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
  pendingRemote: [],

  startCoop: (room, puzzleCode, givens, settings, gameStartsAt, initialMoves) => {
    const serverMoves = new Map<number, ServerMove>();
    for (const sm of initialMoves) serverMoves.set(sm.seq, sm);
    // Drain anything buffered during the fetch-then-subscribe window. Dedup
    // by seq so a re-delivery is a no-op.
    for (const m of get().pendingRemote) {
      if (!serverMoves.has(m.seq)) serverMoves.set(m.seq, m);
    }
    // initialMoves (+ drained buffer) is an authoritative full fetch, so any
    // hole in it is an abandoned reservation, not a dropped event. Seed the
    // known-missing set from it; a new round restarts seqs at 1 so this also
    // clears stale entries from the prior round.
    knownMissingSeqs = computeAbandonedHoles(serverMoves);
    const remoteBoard = materializeRemote(puzzleCode, givens, serverMoves);
    set({
      room,
      puzzleCode,
      givens,
      serverMoves,
      pendings: [],
      remoteBoard,
      board: remoteBoard,
      history: createHistory(),
      selected: null,
      notesMode: false,
      settings,
      conflicts: recomputeConflicts(remoteBoard, settings.showConflicts),
      startedAt: gameStartsAt,
      finishedAt: null,
      sharedProgressPct: 0,
      lastError: null,
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

    if (!notesMode && cell.value === value) {
      await get().clearCell();
      return;
    }

    const move: Move = notesMode
      ? { kind: 'note_toggle', cell: selected, value }
      : { kind: 'value', cell: selected, value };

    // Optimistic: append to pendings + overlay on remoteBoard.
    const cid = newCid();
    const pendings = [...get().pendings, { cid, move, submittedAt: Date.now() }];
    const { remoteBoard, settings, history } = get();
    if (!remoteBoard) return;
    const nextBoard = overlayPendings(remoteBoard, pendings);
    if (nextBoard === board) return;
    // Local history records every applied move (server-confirmed + pending)
    // so the user's undo stack reflects their typing. We diff against the
    // pre-apply board.
    const historyEntry = {
      undoStack: [
        ...history.undoStack,
        {
          move,
          priors: diffPriors(board, nextBoard),
        },
      ],
      redoStack: [],
    };
    set({
      pendings,
      board: nextBoard,
      history: historyEntry,
      conflicts: recomputeConflicts(nextBoard, settings.showConflicts),
    });

    const res = await enqueueMove(room.room_id, {
      cell: move.cell,
      kind: move.kind,
      value: move.kind === 'value' || move.kind === 'note_toggle' ? value : null,
      client_move_id: cid,
    });

    if (!res.ok) {
      set({ lastError: res.error.message });
      // Drop the failed pending, then resync to the server's truth.
      const remaining = get().pendings.filter((p) => p.cid !== cid);
      set({ pendings: remaining });
      await get().resync();
      return;
    }
    // Success path: the realtime echo with our client_move_id is the
    // canonical signal — that's when we move from pendings to serverMoves.
    // The HTTP response gives us progress + won + autocheck. The realtime
    // echo will arrive shortly (or, if it raced and arrived first, the
    // pending was already removed).
    set({
      sharedProgressPct: res.value.progress_pct,
      lastError: null,
    });
    if (res.value.won) {
      set({ finishedAt: Date.now() });
    }
  },

  enterNote: async (value) => {
    const { board, selected, room, finishedAt, startedAt, remoteBoard } = get();
    if (!board || !room || selected === null || finishedAt !== null) return;
    if (!remoteBoard) return;
    if (startedAt !== null && Date.now() < startedAt) return;
    const cell = board.cells[selected];
    if (!cell || cell.given !== null || cell.value !== null) return;
    const move: Move = { kind: 'note_toggle', cell: selected, value };
    const cid = newCid();
    const pendings = [...get().pendings, { cid, move, submittedAt: Date.now() }];
    const nextBoard = overlayPendings(remoteBoard, pendings);
    if (nextBoard === board) return;
    const { settings, history } = get();
    set({
      pendings,
      board: nextBoard,
      history: {
        undoStack: [
          ...history.undoStack,
          { move, priors: diffPriors(board, nextBoard) },
        ],
        redoStack: [],
      },
      conflicts: recomputeConflicts(nextBoard, settings.showConflicts),
    });
    const res = await enqueueMove(room.room_id, {
      cell: selected,
      kind: 'note_toggle',
      value,
      client_move_id: cid,
    });
    if (!res.ok) {
      set({
        lastError: res.error.message,
        pendings: get().pendings.filter((p) => p.cid !== cid),
      });
      await get().resync();
      return;
    }
    set({ sharedProgressPct: res.value.progress_pct, lastError: null });
  },

  clearCell: async () => {
    const { board, selected, room, finishedAt, startedAt, remoteBoard } = get();
    if (!board || !room || selected === null || finishedAt !== null) return;
    if (!remoteBoard) return;
    if (startedAt !== null && Date.now() < startedAt) return;
    const cell = board.cells[selected];
    if (!cell || cell.given !== null) return;

    const move: Move = { kind: 'clear', cell: selected };
    const cid = newCid();
    const pendings = [...get().pendings, { cid, move, submittedAt: Date.now() }];
    const nextBoard = overlayPendings(remoteBoard, pendings);
    if (nextBoard === board) return;
    const { settings, history } = get();
    set({
      pendings,
      board: nextBoard,
      history: {
        undoStack: [
          ...history.undoStack,
          { move, priors: diffPriors(board, nextBoard) },
        ],
        redoStack: [],
      },
      conflicts: recomputeConflicts(nextBoard, settings.showConflicts),
    });

    const res = await enqueueMove(room.room_id, {
      cell: selected,
      kind: 'clear',
      value: null,
      client_move_id: cid,
    });
    if (!res.ok) {
      set({
        lastError: res.error.message,
        pendings: get().pendings.filter((p) => p.cid !== cid),
      });
      await get().resync();
      return;
    }
    set({ sharedProgressPct: res.value.progress_pct, lastError: null });
  },

  undo: async () => {
    // Coop undo emits a server-side compensating move so other players see
    // the revert. The local-only undo of the previous version diverged a
    // player's view from the room's truth, which broke "everyone sees the
    // same board." Implementation: pop the local history entry, figure out
    // what cell+value to write to restore the prior visible value, and
    // submit a fresh move with that intent.
    const { board, room, history, settings, remoteBoard } = get();
    if (!board || !room || !remoteBoard) return;
    if (!canUndo(history)) return;
    // Restore locally first for immediate feedback.
    const undone = undoHistory(board, history);
    set({
      board: undone.state,
      history: undone.history,
      conflicts: recomputeConflicts(undone.state, settings.showConflicts),
    });
    // Figure out what the prior cell state was for the undone move's target.
    const top = history.undoStack[history.undoStack.length - 1];
    if (!top) return;
    const targetCell = top.move.cell;
    const priorCellState = top.priors.find((p) => p.index === targetCell);
    if (!priorCellState) return;
    // Emit a compensating server move: if the prior was empty, send a
    // 'clear'; if the prior had a value, send a 'value' with that value;
    // for a note_toggle undo, send the same note_toggle (toggles are
    // self-inverse on the same bit).
    let compensating: Move;
    if (top.move.kind === 'note_toggle') {
      compensating = { kind: 'note_toggle', cell: targetCell, value: top.move.value };
    } else if (priorCellState.cell.value !== null) {
      compensating = {
        kind: 'value',
        cell: targetCell,
        value: priorCellState.cell.value as CellValue,
      };
    } else {
      compensating = { kind: 'clear', cell: targetCell };
    }
    const cid = newCid();
    set({ pendings: [...get().pendings, { cid, move: compensating, submittedAt: Date.now() }] });
    const res = await enqueueMove(room.room_id, {
      cell: compensating.cell,
      kind: compensating.kind,
      value: compensating.kind === 'clear' ? null : compensating.value,
      client_move_id: cid,
    });
    if (!res.ok) {
      set({
        lastError: res.error.message,
        pendings: get().pendings.filter((p) => p.cid !== cid),
      });
      await get().resync();
      return;
    }
    set({ sharedProgressPct: res.value.progress_pct, lastError: null });
  },

  redo: async () => {
    // Symmetric to undo: re-apply the redone move and emit it server-side
    // so peers see it too.
    const { board, room, history, settings, remoteBoard } = get();
    if (!board || !room || !remoteBoard) return;
    if (!canRedo(history)) return;
    const result = redoHistory(board, history);
    if (result.state === board) return;
    set({
      board: result.state,
      history: result.history,
      conflicts: recomputeConflicts(result.state, settings.showConflicts),
    });
    const top = history.redoStack[history.redoStack.length - 1];
    if (!top) return;
    const cid = newCid();
    set({ pendings: [...get().pendings, { cid, move: top.move, submittedAt: Date.now() }] });
    const res = await enqueueMove(room.room_id, {
      cell: top.move.cell,
      kind: top.move.kind,
      value: top.move.kind === 'clear' ? null : top.move.value,
      client_move_id: cid,
    });
    if (!res.ok) {
      set({
        lastError: res.error.message,
        pendings: get().pendings.filter((p) => p.cid !== cid),
      });
      await get().resync();
      return;
    }
    set({ sharedProgressPct: res.value.progress_pct, lastError: null });
  },

  applyRemoteMove: (m) => {
    const { room, puzzleCode, givens, serverMoves, pendings, pendingRemote, settings } = get();

    // No board yet → buffer until startCoop runs. Dedup by seq vs. the
    // buffer too in case realtime double-delivers during reconnect.
    if (!puzzleCode || !givens || !room) {
      if (pendingRemote.some((p) => p.seq === m.seq)) return;
      set({ pendingRemote: [...pendingRemote, m] });
      return;
    }

    // Already folded in (rare double-delivery).
    if (serverMoves.has(m.seq)) return;

    const nextServerMoves = new Map(serverMoves);
    nextServerMoves.set(m.seq, m);

    // If this is the echo of one of our own pendings, drop the pending.
    // client_move_id is the right dedup key — unique per move globally and
    // known by both client (we generated it) and server (it broadcasts it
    // in the moves row).
    const nextPendings = m.client_move_id
      ? pendings.filter((p) => p.cid !== m.client_move_id)
      : pendings;

    const nextRemoteBoard = materializeRemote(puzzleCode, givens, nextServerMoves);
    const nextBoard = overlayPendings(nextRemoteBoard, nextPendings);
    set({
      serverMoves: nextServerMoves,
      pendings: nextPendings,
      remoteBoard: nextRemoteBoard,
      board: nextBoard,
      conflicts: recomputeConflicts(nextBoard, settings.showConflicts),
    });

    // Gap detection: if there's a hole in the seq sequence (postgres_changes
    // dropped or delayed an event), schedule a debounced refetch. If the
    // hole fills via subsequent realtime events before the timer fires,
    // cancelGapResync below clears it.
    if (hasSeqGap(nextServerMoves)) {
      scheduleGapResync(() => void get().resync());
    } else {
      cancelGapResync();
    }
  },

  resync: async () => {
    const { room, puzzleCode, givens, pendings, settings } = get();
    if (!room || !puzzleCode || !givens) return;
    // Clear any pending gap-resync timer; we're about to do the canonical
    // refetch ourselves.
    cancelGapResync();
    const moves = await fetchAllMoves(room.room_id);
    const serverMoves = new Map<number, ServerMove>();
    for (const sm of moves) serverMoves.set(sm.seq, sm);
    // This is the authoritative snapshot; recompute which seqs are genuinely
    // abandoned so post-resync gap checks don't re-trigger on the same holes.
    knownMissingSeqs = computeAbandonedHoles(serverMoves);
    // Drop pendings that have already landed (their cid is in serverMoves);
    // keep ones still genuinely in flight.
    const remaining = pendings.filter(
      (p) => !moves.some((m) => m.client_move_id === p.cid),
    );
    const remoteBoard = materializeRemote(puzzleCode, givens, serverMoves);
    const board = overlayPendings(remoteBoard, remaining);
    set({
      serverMoves,
      pendings: remaining,
      remoteBoard,
      board,
      conflicts: recomputeConflicts(board, settings.showConflicts),
      // History is local; we leave it intact so the user's undo stack
      // still works for their own session.
    });
  },

  markFinished: () => {
    if (get().finishedAt === null) set({ finishedAt: Date.now() });
  },
}));

/**
 * Local equivalent of the history module's diffPriors. The coop store builds
 * undoStack entries by hand because it needs to record priors against the
 * overlay board (which includes pendings), not the result of applyMove
 * alone. Identical algorithm: any cells whose Cell ref changed are recorded
 * with their PRE-move state so undo can restore them.
 */
function diffPriors(
  prev: BoardState,
  next: BoardState,
): Array<{ index: number; cell: Cell }> {
  const out: Array<{ index: number; cell: Cell }> = [];
  for (let i = 0; i < prev.cells.length; i++) {
    if (prev.cells[i] !== next.cells[i]) {
      out.push({ index: i, cell: prev.cells[i]! });
    }
  }
  return out;
}

export function selectCoopCanUndo(s: CoopState): boolean {
  return canUndo(s.history);
}
export function selectCoopCanRedo(s: CoopState): boolean {
  return canRedo(s.history);
}
