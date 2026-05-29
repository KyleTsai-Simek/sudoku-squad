import type { BoardState, Move } from '../types/index';
import { applyMove } from './reducer';
import { notesToArray } from './notes';

/**
 * Produce a sequence of moves that, applied in order to `current`, yields
 * `desired` — exactly, cell-for-cell, notes included.
 *
 * Why this exists: our move primitives are *effectful*, not absolute setters.
 * A `value` placement also auto-clears that digit from every peer cell's notes
 * (the "smart notes" rule, see reducer.ts), and `clear` wipes a cell's notes.
 * That makes a single inverse move insufficient to undo a placement: emitting a
 * lone `clear` to undo `value` neither restores the target's prior pencil-marks
 * nor the peer notes the placement auto-cleared. Locally `undo` restores all of
 * them (history records every touched cell), but the server move log — which is
 * the source of truth every client replays — would only ever see the `clear`,
 * so a later resync silently drops those notes. This is the local↔server
 * divergence; `movesToReach` closes it by turning "make the board look like
 * this" into a faithful, replayable list of real moves.
 *
 * Pure. It builds the list in three passes while *simulating* each emitted move
 * on a scratch board, so later passes see the true intermediate state:
 *
 *   1. `clear` every differing cell that holds content — a clean slate, and
 *      `clear` has no peer side effects.
 *   2. Place target `value`s. A placement re-clears its digit from peers — and
 *      crucially `desired` is NOT guaranteed to be auto-clean-consistent (a note
 *      can be toggled onto a peer *after* a value was placed), so this can wrongly
 *      strip a peer note `desired` wants to keep, even on a cell outside the diff.
 *   3. Reconcile notes against the simulated board across *every* non-given cell
 *      (not just the diff), toggling each differing bit. Running this last — after
 *      all placements, with `note_toggle`'s no peer side effects — guarantees the
 *      final note set matches `desired` exactly, repairing anything pass 2 stripped.
 *
 * Givens never change, so given cells are skipped.
 *
 * Invariant (property-tested): `applyMoves(current, movesToReach(current, d))`
 * equals `d` for any reducer-reachable boards sharing the same givens.
 */
export function movesToReach(current: BoardState, desired: BoardState): Move[] {
  const moves: Move[] = [];
  let work = current;
  const emit = (move: Move) => {
    const next = applyMove(work, move);
    if (next === work) return; // no-op — don't log a move that changes nothing
    work = next;
    moves.push(move);
  };

  const n = Math.min(current.cells.length, desired.cells.length);

  const diff: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = current.cells[i]!;
    const d = desired.cells[i]!;
    if (d.given !== null) continue;
    if (c.value === d.value && c.notes === d.notes) continue;
    diff.push(i);
  }

  // Pass 1 — clear differing cells that currently hold content.
  for (const i of diff) {
    const c = work.cells[i]!;
    if (c.value !== null || c.notes !== 0) emit({ kind: 'clear', cell: i });
  }

  // Pass 2 — place target values.
  for (const i of diff) {
    const d = desired.cells[i]!;
    if (d.value !== null) emit({ kind: 'value', cell: i, value: d.value });
  }

  // Pass 3 — reconcile notes everywhere against the simulated board. A pass-2
  // placement may have stripped a peer's note (even on a non-diff cell), so we
  // can't restrict this to `diff`.
  for (let i = 0; i < n; i++) {
    const d = desired.cells[i]!;
    if (d.given !== null || d.value !== null) continue;
    const w = work.cells[i]!;
    if (w.notes === d.notes) continue;
    // Toggle exactly the bits that differ (XOR) to drive work.notes → d.notes.
    const differing = w.notes ^ d.notes;
    for (const v of notesToArray(differing)) emit({ kind: 'note_toggle', cell: i, value: v });
  }

  return moves;
}
