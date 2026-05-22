import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyMove, applyMoves } from './reducer';
import { createBoard } from '../puzzle/board';
import { findConflicts } from '../puzzle/validator';
import { hasNote, notesToArray } from './notes';
import type { BoardState, CellValue, Move } from '../types/index';

const EMPTY_GIVENS = Array<number>(81).fill(0);

// A puzzle with a clue at cell 0 (value 5) and empties elsewhere — useful for
// asserting that the reducer refuses to write to given cells.
const ONE_CLUE_GIVENS: number[] = [5, ...Array<number>(80).fill(0)];

function freshBoard(): BoardState {
  return createBoard('test', EMPTY_GIVENS);
}

describe('applyMove — value', () => {
  it('sets the value on an empty cell', () => {
    const next = applyMove(freshBoard(), { kind: 'value', cell: 5, value: 7 });
    expect(next.cells[5]?.value).toBe(7);
  });

  it('clears notes when setting a value', () => {
    const board = applyMove(freshBoard(), { kind: 'note_toggle', cell: 5, value: 3 });
    expect(board.cells[5]?.notes).not.toBe(0);
    const next = applyMove(board, { kind: 'value', cell: 5, value: 7 });
    expect(next.cells[5]?.notes).toBe(0);
    expect(next.cells[5]?.value).toBe(7);
  });

  it('refuses to overwrite a given cell', () => {
    const board = createBoard('test', ONE_CLUE_GIVENS);
    const next = applyMove(board, { kind: 'value', cell: 0, value: 7 });
    expect(next).toBe(board);
    expect(next.cells[0]?.given).toBe(5);
    expect(next.cells[0]?.value).toBeNull();
  });

  it('returns the same reference when value is unchanged', () => {
    const board = applyMove(freshBoard(), { kind: 'value', cell: 5, value: 7 });
    const again = applyMove(board, { kind: 'value', cell: 5, value: 7 });
    expect(again).toBe(board);
  });

  it('does not mutate the input state', () => {
    const board = freshBoard();
    applyMove(board, { kind: 'value', cell: 5, value: 7 });
    expect(board.cells[5]?.value).toBeNull();
  });
});

describe('applyMove — clear', () => {
  it('clears both value and notes', () => {
    let board = applyMove(freshBoard(), { kind: 'value', cell: 5, value: 7 });
    board = applyMove(board, { kind: 'note_toggle', cell: 10, value: 3 });
    board = applyMove(board, { kind: 'clear', cell: 5 });
    expect(board.cells[5]?.value).toBeNull();
    expect(board.cells[5]?.notes).toBe(0);
  });

  it('refuses to clear a given cell', () => {
    const board = createBoard('test', ONE_CLUE_GIVENS);
    const next = applyMove(board, { kind: 'clear', cell: 0 });
    expect(next).toBe(board);
    expect(next.cells[0]?.given).toBe(5);
  });

  it('is a no-op on an already-empty cell', () => {
    const board = freshBoard();
    const next = applyMove(board, { kind: 'clear', cell: 42 });
    expect(next).toBe(board);
  });
});

describe('applyMove — note_toggle', () => {
  it('adds a note bit on first toggle', () => {
    const next = applyMove(freshBoard(), { kind: 'note_toggle', cell: 5, value: 3 });
    expect(hasNote(next.cells[5]!.notes, 3)).toBe(true);
  });

  it('removes a note bit on second toggle', () => {
    let board = applyMove(freshBoard(), { kind: 'note_toggle', cell: 5, value: 3 });
    board = applyMove(board, { kind: 'note_toggle', cell: 5, value: 3 });
    expect(board.cells[5]?.notes).toBe(0);
  });

  it('refuses to toggle notes on a given cell', () => {
    const board = createBoard('test', ONE_CLUE_GIVENS);
    const next = applyMove(board, { kind: 'note_toggle', cell: 0, value: 3 });
    expect(next).toBe(board);
  });

  it('refuses to toggle notes when the cell already has a value', () => {
    const board = applyMove(freshBoard(), { kind: 'value', cell: 5, value: 7 });
    const next = applyMove(board, { kind: 'note_toggle', cell: 5, value: 3 });
    expect(next).toBe(board);
  });
});

describe('applyMove — value auto-cleans peer notes', () => {
  // Cell 0 is row 0, col 0, box 0. Peers include cells 1..8 (same row),
  // 9, 18, 27, 36, 45, 54, 63, 72 (same col), and 10, 11, 19, 20 (rest of box 0).
  it("removes the placed value from every peer cell's notes", () => {
    let board = freshBoard();
    // Seed pencil-marks of 7 in a same-row peer, a same-col peer, a same-box
    // peer, and an unrelated cell (which should NOT be cleaned).
    board = applyMove(board, { kind: 'note_toggle', cell: 3, value: 7 }); // row 0
    board = applyMove(board, { kind: 'note_toggle', cell: 18, value: 7 }); // col 0
    board = applyMove(board, { kind: 'note_toggle', cell: 10, value: 7 }); // box 0
    board = applyMove(board, { kind: 'note_toggle', cell: 40, value: 7 }); // unrelated
    board = applyMove(board, { kind: 'value', cell: 0, value: 7 });

    expect(hasNote(board.cells[3]!.notes, 7)).toBe(false);
    expect(hasNote(board.cells[18]!.notes, 7)).toBe(false);
    expect(hasNote(board.cells[10]!.notes, 7)).toBe(false);
    // Unrelated cell keeps its note.
    expect(hasNote(board.cells[40]!.notes, 7)).toBe(true);
  });

  it('leaves OTHER notes on the same peer alone', () => {
    let board = freshBoard();
    board = applyMove(board, { kind: 'note_toggle', cell: 3, value: 7 });
    board = applyMove(board, { kind: 'note_toggle', cell: 3, value: 4 });
    board = applyMove(board, { kind: 'value', cell: 0, value: 7 });
    expect(hasNote(board.cells[3]!.notes, 7)).toBe(false);
    expect(hasNote(board.cells[3]!.notes, 4)).toBe(true);
  });

  it('placing the value still counts as a real move when only peer notes change', () => {
    let board = freshBoard();
    board = applyMove(board, { kind: 'value', cell: 0, value: 7 });
    board = applyMove(board, { kind: 'note_toggle', cell: 3, value: 7 });
    // Re-placing the same value on cell 0 is a no-op for cell 0 itself but
    // SHOULD clean the just-added note on cell 3.
    const next = applyMove(board, { kind: 'value', cell: 0, value: 7 });
    expect(next).not.toBe(board);
    expect(hasNote(next.cells[3]!.notes, 7)).toBe(false);
  });

  it('is a true no-op (same reference) when nothing changes', () => {
    let board = freshBoard();
    board = applyMove(board, { kind: 'value', cell: 0, value: 7 });
    // No peer notes exist, target is already 7 with no notes — should be no-op.
    const next = applyMove(board, { kind: 'value', cell: 0, value: 7 });
    expect(next).toBe(board);
  });
});

describe('applyMoves (replay convenience)', () => {
  it('matches a step-by-step fold', () => {
    const moves: Move[] = [
      { kind: 'value', cell: 0, value: 1 },
      { kind: 'note_toggle', cell: 1, value: 2 },
      { kind: 'value', cell: 1, value: 5 }, // clears note
      { kind: 'clear', cell: 0 },
    ];
    const board = freshBoard();
    const replayed = applyMoves(board, moves);
    let folded = board;
    for (const m of moves) folded = applyMove(folded, m);
    expect(replayed).toEqual(folded);
  });
});

// ----------------------------------------------------------------------------
// Property-based tests with fast-check.
// ----------------------------------------------------------------------------

const arbCellIndex = fc.integer({ min: 0, max: 80 });
const arbCellValue = fc.integer({ min: 1, max: 9 }) as fc.Arbitrary<CellValue>;

const arbMove: fc.Arbitrary<Move> = fc.oneof(
  fc.record({
    kind: fc.constant('value' as const),
    cell: arbCellIndex,
    value: arbCellValue,
  }),
  fc.record({
    kind: fc.constant('clear' as const),
    cell: arbCellIndex,
  }),
  fc.record({
    kind: fc.constant('note_toggle' as const),
    cell: arbCellIndex,
    value: arbCellValue,
  }),
);

describe('reducer properties', () => {
  it('every cell value is null or in 1..9 after any sequence of moves', () => {
    fc.assert(
      fc.property(fc.array(arbMove, { maxLength: 200 }), (moves) => {
        const state = applyMoves(freshBoard(), moves);
        for (const cell of state.cells) {
          if (cell.value !== null) {
            expect(cell.value).toBeGreaterThanOrEqual(1);
            expect(cell.value).toBeLessThanOrEqual(9);
          }
          if (cell.notes !== 0) {
            const notes = notesToArray(cell.notes);
            for (const v of notes) {
              expect(v).toBeGreaterThanOrEqual(1);
              expect(v).toBeLessThanOrEqual(9);
            }
          }
        }
      }),
    );
  });

  it('replay equals fold for any move log', () => {
    fc.assert(
      fc.property(fc.array(arbMove, { maxLength: 200 }), (moves) => {
        const start = freshBoard();
        const a = applyMoves(start, moves);
        let b = start;
        for (const m of moves) b = applyMove(b, m);
        expect(a).toEqual(b);
      }),
    );
  });

  it('given cells are never modified by any move', () => {
    const board = createBoard('test', ONE_CLUE_GIVENS);
    fc.assert(
      fc.property(fc.array(arbMove, { maxLength: 200 }), (moves) => {
        const next = applyMoves(board, moves);
        expect(next.cells[0]?.given).toBe(5);
        expect(next.cells[0]?.value).toBeNull();
        expect(next.cells[0]?.notes).toBe(0);
      }),
    );
  });

  it('clearing a non-given cell always leaves value=null and notes=0', () => {
    fc.assert(
      fc.property(fc.array(arbMove, { maxLength: 100 }), arbCellIndex, (moves, target) => {
        let state = applyMoves(freshBoard(), moves);
        state = applyMove(state, { kind: 'clear', cell: target });
        const cell = state.cells[target]!;
        expect(cell.value).toBeNull();
        expect(cell.notes).toBe(0);
      }),
    );
  });

  it('the reducer never introduces a row/col/box conflict that was not implied by the inputs', () => {
    // Specifically: after applying any sequence, findConflicts only flags cells
    // whose values were placed by the moves themselves (no spurious flags on
    // empty cells). This guards the validator boundary.
    fc.assert(
      fc.property(fc.array(arbMove, { maxLength: 200 }), (moves) => {
        const state = applyMoves(freshBoard(), moves);
        const conflicts = findConflicts(state);
        for (const idx of conflicts) {
          const cell = state.cells[idx]!;
          // Only filled cells may be flagged.
          expect(cell.value !== null || cell.given !== null).toBe(true);
        }
      }),
    );
  });
});
