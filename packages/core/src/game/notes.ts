import type { CellValue, NotesMask } from '../types/index';

/**
 * Pencil-mark notes are stored as a 9-bit bitmask. Bit (v-1) set means
 * note `v` is present. All helpers below are pure: they return a new mask.
 */

const ALL_NOTES: NotesMask = 0b1_1111_1111;

function bitFor(value: CellValue): number {
  return 1 << (value - 1);
}

export function hasNote(mask: NotesMask, value: CellValue): boolean {
  return (mask & bitFor(value)) !== 0;
}

export function setNote(mask: NotesMask, value: CellValue): NotesMask {
  return (mask | bitFor(value)) & ALL_NOTES;
}

export function clearNote(mask: NotesMask, value: CellValue): NotesMask {
  return mask & ~bitFor(value) & ALL_NOTES;
}

export function toggleNote(mask: NotesMask, value: CellValue): NotesMask {
  return (mask ^ bitFor(value)) & ALL_NOTES;
}

/** Returns the notes 1..9 currently set, in ascending order. */
export function notesToArray(mask: NotesMask): CellValue[] {
  const out: CellValue[] = [];
  for (let v = 1; v <= 9; v++) {
    if (mask & (1 << (v - 1))) out.push(v as CellValue);
  }
  return out;
}

export function clearAllNotes(): NotesMask {
  return 0;
}
