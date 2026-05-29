import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { movesToReach } from './board-diff';
import { applyMove, applyMoves } from './reducer';
import { undo as undoHistory, applyMoveWithHistory, createHistory } from './history';
import { createBoard } from '../puzzle/board';
import type { BoardState, Move } from '../types/index';

const EMPTY_GIVENS = Array<number>(81).fill(0);
// A board with a handful of clue cells, to exercise the given-skipping path.
const SOME_GIVENS: number[] = (() => {
  const g = Array<number>(81).fill(0);
  g[0] = 5;
  g[40] = 3;
  g[80] = 9;
  return g;
})();

function boardsEqual(a: BoardState, b: BoardState): boolean {
  if (a.cells.length !== b.cells.length) return false;
  for (let i = 0; i < a.cells.length; i++) {
    const x = a.cells[i]!;
    const y = b.cells[i]!;
    if (x.given !== y.given || x.value !== y.value || x.notes !== y.notes) return false;
  }
  return true;
}

const cellArb = fc.integer({ min: 0, max: 80 });
const valueArb = fc.integer({ min: 1, max: 9 });
const moveArb: fc.Arbitrary<Move> = fc.oneof(
  fc.record({ kind: fc.constant('value' as const), cell: cellArb, value: valueArb }),
  fc.record({ kind: fc.constant('clear' as const), cell: cellArb }),
  fc.record({ kind: fc.constant('note_toggle' as const), cell: cellArb, value: valueArb }),
);

function buildBoard(givens: number[], moves: Move[]): BoardState {
  return applyMoves(createBoard('test', givens), moves);
}

describe('movesToReach — exact reconstruction', () => {
  it('produces no moves when boards already match', () => {
    const board = buildBoard(EMPTY_GIVENS, [{ kind: 'value', cell: 5, value: 7 }]);
    expect(movesToReach(board, board)).toEqual([]);
  });

  it('restores auto-cleared peer notes when undoing a value placement', () => {
    // cell 0 and its row-peer cell 1 both carry note 7; placing 7 in cell 0
    // auto-clears note 7 from cell 1 (and clears cell 0's own notes).
    let before = createBoard('test', EMPTY_GIVENS);
    before = applyMove(before, { kind: 'note_toggle', cell: 0, value: 7 });
    before = applyMove(before, { kind: 'note_toggle', cell: 0, value: 3 });
    before = applyMove(before, { kind: 'note_toggle', cell: 1, value: 7 });

    const after = applyMove(before, { kind: 'value', cell: 0, value: 7 });
    expect(after.cells[1]!.notes).toBe(0); // peer note 7 was auto-cleared
    expect(after.cells[0]!.value).toBe(7);

    // The lone-`clear` approach the old code used would NOT restore notes.
    const naive = applyMove(after, { kind: 'clear', cell: 0 });
    expect(boardsEqual(naive, before)).toBe(false);

    // movesToReach restores `before` exactly — target notes AND the peer note.
    const recovered = applyMoves(after, movesToReach(after, before));
    expect(boardsEqual(recovered, before)).toBe(true);
  });

  it('restores a peer note added AFTER the value was placed (auto-clean is not a global invariant)', () => {
    // Regression for a movesToReach counterexample: cells 21 and 12 share a
    // column (peers). Place 7 in 21, THEN pencil 7 into 12 (the reducer only
    // auto-cleans at placement time, so this is a legal state where a value
    // cell and a peer note of the same digit coexist), then clear 21. Undoing
    // the clear lands on { 21: value 7, 12: note 7 } — a board that violates
    // the auto-clean invariant. movesToReach must still reproduce it exactly:
    // re-placing 7 in 21 strips note 7 from 12, so pass 3 must put it back.
    let board = createBoard('test', EMPTY_GIVENS);
    board = applyMove(board, { kind: 'value', cell: 21, value: 7 });
    board = applyMove(board, { kind: 'note_toggle', cell: 12, value: 7 });
    const current = applyMove(board, { kind: 'clear', cell: 21 });
    const desired = board; // = state right before the clear

    expect(current.cells[21]!.value).toBeNull();
    expect(desired.cells[21]!.value).toBe(7);
    expect(desired.cells[12]!.notes).not.toBe(0);

    const recovered = applyMoves(current, movesToReach(current, desired));
    expect(boardsEqual(recovered, desired)).toBe(true);
  });

  it('never targets a given cell', () => {
    const desired = buildBoard(SOME_GIVENS, [{ kind: 'note_toggle', cell: 41, value: 2 }]);
    const moves = movesToReach(createBoard('test', SOME_GIVENS), desired);
    for (const m of moves) {
      expect([0, 40, 80]).not.toContain(m.cell);
    }
  });
});

describe('movesToReach — property: applyMoves(current, diff) === desired', () => {
  it('holds for arbitrary reducer-reachable boards (empty givens)', () => {
    fc.assert(
      fc.property(fc.array(moveArb, { maxLength: 40 }), fc.array(moveArb, { maxLength: 40 }), (a, b) => {
        const current = buildBoard(EMPTY_GIVENS, a);
        const desired = buildBoard(EMPTY_GIVENS, b);
        const recovered = applyMoves(current, movesToReach(current, desired));
        return boardsEqual(recovered, desired);
      }),
      { numRuns: 1000 },
    );
  });

  it('holds with givens present (and never mutates them)', () => {
    fc.assert(
      fc.property(fc.array(moveArb, { maxLength: 40 }), fc.array(moveArb, { maxLength: 40 }), (a, b) => {
        const current = buildBoard(SOME_GIVENS, a);
        const desired = buildBoard(SOME_GIVENS, b);
        const recovered = applyMoves(current, movesToReach(current, desired));
        return boardsEqual(recovered, desired);
      }),
      { numRuns: 1000 },
    );
  });

  it('reconstructs the exact board an undo lands on', () => {
    fc.assert(
      fc.property(fc.array(moveArb, { minLength: 1, maxLength: 40 }), (a) => {
        // Build a board + history, then undo the last move. The board the undo
        // lands on must be reconstructable from the move log via movesToReach.
        let board = createBoard('test', EMPTY_GIVENS);
        let history = createHistory();
        for (const m of a) {
          const r = applyMoveWithHistory(board, history, m);
          board = r.state;
          history = r.history;
        }
        if (history.undoStack.length === 0) return true; // all were no-ops
        const undone = undoHistory(board, history);
        const recovered = applyMoves(board, movesToReach(board, undone.state));
        return boardsEqual(recovered, undone.state);
      }),
      { numRuns: 1000 },
    );
  });
});
