'use client';

import { create } from 'zustand';
import {
  applyMove,
  applyMoveWithHistory,
  applyMoves,
  canRedo,
  canUndo,
  computeAbandonedHoles,
  createBoard,
  createHistory,
  findConflicts,
  firstMissingSeq,
  hasSeqGap,
  movesToReach,
  peekLastMove,
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
  fetchMovesSince,
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
  pausedAt: number | null;
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
  pauseLocal: (pausedAt?: number) => void;
  resumeLocal: () => void;
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

/**
 * Drive the shared board from `fromBoard` to `toBoard` (an undo/redo/smart-clear
 * target) by emitting the faithful move batch from `movesToReach` and treating
 * each as an optimistic pending — exactly like a typed entry. This keeps notes
 * in sync: an undo's restored peer-notes ride along as real `note_toggle` moves
 * in the server log instead of being silently dropped on the next resync. The
 * batch preserves the overlay invariant `board === overlayPendings(remoteBoard,
 * pendings)`, so a concurrent realtime re-materialize stays consistent.
 * See DECISIONS #0041. Mirrors battle's submitCompensatingMoves.
 */
async function submitCoopCompensation(
  get: () => CoopState,
  set: (s: Partial<CoopState>) => void,
  fromBoard: BoardState,
  toBoard: BoardState,
  nextHistory: MoveHistory,
): Promise<void> {
  const { settings } = get();
  const compensating = movesToReach(fromBoard, toBoard);
  const entries = compensating.map((move) => ({
    cid: newCid(),
    move,
    submittedAt: Date.now(),
  }));
  set({
    board: toBoard,
    history: nextHistory,
    pendings: [...get().pendings, ...entries],
    conflicts: recomputeConflicts(toBoard, settings.showConflicts),
  });
  if (entries.length === 0) return;
  const { room } = get();
  if (!room) return;

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

  const failure = results.find((r) => !r.res.ok);
  if (failure && !failure.res.ok) {
    const cids = new Set(entries.map((e) => e.cid));
    set({
      lastError: failure.res.error.message,
      pendings: get().pendings.filter((p) => !cids.has(p.cid)),
    });
    await get().resync();
    return;
  }
  // Success: pendings drop out when their realtime echoes arrive (deduped by
  // client_move_id in applyRemoteMove). Take progress/win from the last result.
  const last = results[results.length - 1];
  if (last && last.res.ok) {
    set({ sharedProgressPct: last.res.value.progress_pct, lastError: null });
    if (last.res.value.won) set({ finishedAt: Date.now() });
  }
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
  pausedAt: null,
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
    knownMissingSeqs = computeAbandonedHoles(serverMoves.keys());
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
      pausedAt: null,
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

  pauseLocal: (pausedAt = Date.now()) => {
    const { board, startedAt, finishedAt, pausedAt: existingPausedAt } = get();
    if (!board || startedAt === null || finishedAt !== null || existingPausedAt !== null) {
      return;
    }
    set({ pausedAt: Math.max(startedAt, pausedAt) });
  },

  resumeLocal: () => {
    if (get().pausedAt === null) return;
    set({ pausedAt: null });
  },

  selectCell: (cell) => set({ selected: cell }),

  moveSelection: (dx, dy) => {
    if (get().pausedAt !== null) return;
    const cur = get().selected ?? 40;
    const row = Math.floor(cur / 9);
    const col = cur % 9;
    const nr = Math.max(0, Math.min(8, row + dy));
    const nc = Math.max(0, Math.min(8, col + dx));
    set({ selected: nr * 9 + nc });
  },

  toggleNotesMode: () => {
    if (get().pausedAt !== null) return;
    set({ notesMode: !get().notesMode });
  },
  setNotesMode: (on) => {
    if (get().pausedAt !== null) return;
    set({ notesMode: on });
  },

  enterValue: async (value) => {
    const { board, selected, room, notesMode, finishedAt, startedAt, pausedAt } = get();
    if (!board || !room || selected === null || finishedAt !== null || pausedAt !== null) return;
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
    const { board, selected, room, finishedAt, startedAt, remoteBoard, pausedAt } = get();
    if (!board || !room || selected === null || finishedAt !== null || pausedAt !== null) return;
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
    const { board, selected, room, finishedAt, startedAt, remoteBoard, history, pausedAt } = get();
    if (!board || !room || selected === null || finishedAt !== null || pausedAt !== null) return;
    if (!remoteBoard) return;
    if (startedAt !== null && Date.now() < startedAt) return;
    const cell = board.cells[selected];
    if (!cell || cell.given !== null) return;

    // Smart-clear parity with battle: re-clearing the value you just placed
    // undoes the placement (restoring auto-cleaned peer notes) instead of a
    // destructive clear. Either way, drive the board to the target and emit the
    // faithful move batch so every client's replay matches. See DECISIONS #0041.
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
    await submitCoopCompensation(get, set, board, result.state, result.history);
  },

  undo: async () => {
    // Coop undo drives the shared board to the reverted state via a faithful
    // move batch (movesToReach), so other players — and our own next resync —
    // see the exact same board, notes included. The previous single-move
    // approach lost the target's prior notes and the auto-cleared peer notes,
    // diverging the log from what the undoing player saw. See DECISIONS #0041.
    const { board, room, history, remoteBoard, pausedAt } = get();
    if (!board || !room || !remoteBoard || pausedAt !== null) return;
    if (!canUndo(history)) return;
    const undone = undoHistory(board, history);
    await submitCoopCompensation(get, set, board, undone.state, undone.history);
  },

  redo: async () => {
    // Symmetric to undo: re-apply locally, then emit the moves that reproduce
    // the resulting board on the server so peers track it too.
    const { board, room, history, remoteBoard, pausedAt } = get();
    if (!board || !room || !remoteBoard || pausedAt !== null) return;
    if (!canRedo(history)) return;
    const result = redoHistory(board, history);
    if (result.state === board) {
      // Orphaned redo entry — redoHistory drops it; keep history in sync.
      set({ history: result.history });
      return;
    }
    await submitCoopCompensation(get, set, board, result.state, result.history);
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
    if (hasSeqGap(nextServerMoves.keys(), knownMissingSeqs)) {
      scheduleGapResync(() => void get().resync());
    } else {
      cancelGapResync();
    }
  },

  resync: async () => {
    const { room, puzzleCode, givens, pendings, settings, serverMoves: existing } = get();
    if (!room || !puzzleCode || !givens) return;
    // Clear any pending gap-resync timer; we're about to do the canonical
    // refetch ourselves.
    cancelGapResync();
    // Delta catch-up (DECISIONS #0040): fetch only from our first hole (or
    // max+1 if contiguous) instead of re-reading the entire log. The DB is
    // authoritative for [since, ∞), so we merge the delta over what we hold.
    const since = firstMissingSeq(existing.keys(), knownMissingSeqs);
    const delta = await fetchMovesSince(room.room_id, since);
    const serverMoves = new Map(existing);
    for (const sm of delta) serverMoves.set(sm.seq, sm);
    // The delta is authoritative for [since, ∞), and everything below `since`
    // was already present or known-abandoned, so the merged map is a faithful
    // snapshot — recompute abandoned holes from it.
    knownMissingSeqs = computeAbandonedHoles(serverMoves.keys());
    // Drop pendings that have already landed (their cid is now in the merged
    // log); keep ones still genuinely in flight.
    const landedCids = new Set<string>();
    for (const m of serverMoves.values()) {
      if (m.client_move_id) landedCids.add(m.client_move_id);
    }
    const remaining = pendings.filter((p) => !landedCids.has(p.cid));
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
