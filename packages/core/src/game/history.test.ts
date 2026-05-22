import { describe, expect, it } from 'vitest';
import {
  applyMoveWithHistory,
  canRedo,
  canUndo,
  createHistory,
  redo,
  undo,
} from './history';
import { createBoard } from '../puzzle/board';

const EMPTY_GIVENS = Array<number>(81).fill(0);

describe('move history', () => {
  it('starts empty', () => {
    const h = createHistory();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it('records applied moves and supports undo', () => {
    const board = createBoard('test', EMPTY_GIVENS);
    const r1 = applyMoveWithHistory(board, createHistory(), {
      kind: 'value',
      cell: 5,
      value: 7,
    });
    expect(r1.state.cells[5]?.value).toBe(7);
    expect(canUndo(r1.history)).toBe(true);

    const r2 = undo(r1.state, r1.history);
    expect(r2.state.cells[5]?.value).toBeNull();
    expect(canUndo(r2.history)).toBe(false);
    expect(canRedo(r2.history)).toBe(true);
  });

  it('undo restores prior notes when a value overwrote them', () => {
    const board = createBoard('test', EMPTY_GIVENS);
    const r1 = applyMoveWithHistory(board, createHistory(), {
      kind: 'note_toggle',
      cell: 10,
      value: 4,
    });
    const r2 = applyMoveWithHistory(r1.state, r1.history, {
      kind: 'value',
      cell: 10,
      value: 9,
    });
    expect(r2.state.cells[10]?.value).toBe(9);
    expect(r2.state.cells[10]?.notes).toBe(0);

    const r3 = undo(r2.state, r2.history);
    expect(r3.state.cells[10]?.value).toBeNull();
    // Note for 4 should be restored.
    expect(r3.state.cells[10]?.notes).not.toBe(0);
  });

  it('redo re-applies the last undone move', () => {
    const board = createBoard('test', EMPTY_GIVENS);
    const r1 = applyMoveWithHistory(board, createHistory(), {
      kind: 'value',
      cell: 5,
      value: 7,
    });
    const r2 = undo(r1.state, r1.history);
    const r3 = redo(r2.state, r2.history);
    expect(r3.state.cells[5]?.value).toBe(7);
    expect(canRedo(r3.history)).toBe(false);
  });

  it('fresh move after undo discards the redo stack', () => {
    const board = createBoard('test', EMPTY_GIVENS);
    const r1 = applyMoveWithHistory(board, createHistory(), {
      kind: 'value',
      cell: 5,
      value: 7,
    });
    const r2 = undo(r1.state, r1.history);
    expect(canRedo(r2.history)).toBe(true);
    const r3 = applyMoveWithHistory(r2.state, r2.history, {
      kind: 'value',
      cell: 6,
      value: 3,
    });
    expect(canRedo(r3.history)).toBe(false);
  });

  it('undo restores peer notes that auto-clean wiped', () => {
    const board = createBoard('test', EMPTY_GIVENS);
    // Seed a pencil-mark of 7 on a peer of cell 0 (cell 3 is same row).
    const r1 = applyMoveWithHistory(board, createHistory(), {
      kind: 'note_toggle',
      cell: 3,
      value: 7,
    });
    // Now place 7 on cell 0 — auto-clean wipes the note on cell 3.
    const r2 = applyMoveWithHistory(r1.state, r1.history, {
      kind: 'value',
      cell: 0,
      value: 7,
    });
    expect(r2.state.cells[0]?.value).toBe(7);
    expect(r2.state.cells[3]?.notes).toBe(0);

    // Undo: cell 0 reverts to empty, AND cell 3 gets its note back.
    const r3 = undo(r2.state, r2.history);
    expect(r3.state.cells[0]?.value).toBeNull();
    expect(r3.state.cells[3]?.notes).not.toBe(0);
  });

  it('redo re-applies auto-clean correctly', () => {
    const board = createBoard('test', EMPTY_GIVENS);
    const r1 = applyMoveWithHistory(board, createHistory(), {
      kind: 'note_toggle',
      cell: 3,
      value: 7,
    });
    const r2 = applyMoveWithHistory(r1.state, r1.history, {
      kind: 'value',
      cell: 0,
      value: 7,
    });
    const r3 = undo(r2.state, r2.history);
    const r4 = redo(r3.state, r3.history);
    expect(r4.state.cells[0]?.value).toBe(7);
    expect(r4.state.cells[3]?.notes).toBe(0);
    // And a subsequent undo still restores correctly after the redo.
    const r5 = undo(r4.state, r4.history);
    expect(r5.state.cells[0]?.value).toBeNull();
    expect(r5.state.cells[3]?.notes).not.toBe(0);
  });

  it('no-op moves do not change history', () => {
    const board = createBoard('test', EMPTY_GIVENS);
    const h = createHistory();
    const r = applyMoveWithHistory(board, h, { kind: 'clear', cell: 0 });
    expect(r.history).toBe(h);
    expect(r.state).toBe(board);
  });
});
