import { describe, expect, it } from 'vitest';
import {
  clearAllNotes,
  clearNote,
  hasNote,
  notesToArray,
  setNote,
  toggleNote,
} from './notes';
import type { CellValue } from '../types/index';

const DIGITS: CellValue[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

describe('notes helpers', () => {
  it('setNote, hasNote, clearNote are consistent across all values', () => {
    let mask = 0;
    for (const v of DIGITS) {
      expect(hasNote(mask, v)).toBe(false);
      mask = setNote(mask, v);
      expect(hasNote(mask, v)).toBe(true);
    }
    for (const v of DIGITS) {
      mask = clearNote(mask, v);
      expect(hasNote(mask, v)).toBe(false);
    }
    expect(mask).toBe(0);
  });

  it('setNote is idempotent', () => {
    const once = setNote(0, 5);
    const twice = setNote(once, 5);
    expect(twice).toBe(once);
  });

  it('clearNote on an unset value is a no-op', () => {
    expect(clearNote(0, 3)).toBe(0);
  });

  it('toggleNote flips a single bit', () => {
    const a = toggleNote(0, 7);
    expect(hasNote(a, 7)).toBe(true);
    const b = toggleNote(a, 7);
    expect(hasNote(b, 7)).toBe(false);
    expect(b).toBe(0);
  });

  it('notesToArray returns ascending values', () => {
    let mask = 0;
    for (const v of [9, 1, 5, 3] as CellValue[]) mask = setNote(mask, v);
    expect(notesToArray(mask)).toEqual([1, 3, 5, 9]);
  });

  it('clearAllNotes returns an empty mask', () => {
    expect(clearAllNotes()).toBe(0);
  });
});
