/**
 * Core domain types for Sudoku Squad.
 *
 * Conventions:
 *  - Cell indices are 0..80, row-major. Row 0 = top, col 0 = left.
 *  - Cell values are 1..9. We use 0 to mean "empty" in compact representations
 *    (e.g., 81-int arrays from the dataset), and `null` in BoardState for clarity.
 *  - Notes are sets of 1..9, represented as a small bitmask for compactness.
 */

export type CellIndex = number; // 0..80
export type CellValue = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Bitmask of notes (pencil marks). Bit (v - 1) set means note v is present. */
export type NotesMask = number;

/** A single 81-int representation of givens or a solution. 0 = empty. */
export type BoardArray = ReadonlyArray<number>;

export interface Cell {
  /** The given clue value, if this cell is a clue. Otherwise null. */
  readonly given: CellValue | null;
  /** The current player-entered value, if any. Null when empty or only notes. */
  value: CellValue | null;
  /** Pencil marks. */
  notes: NotesMask;
}

export interface BoardState {
  readonly puzzleId: PuzzleId;
  readonly cells: Cell[]; // length 81
}

export type PuzzleId = string;
export type PlayerId = string;
export type RoomId = string;

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

export interface Puzzle {
  readonly id: PuzzleId;
  readonly difficulty: Difficulty;
  readonly givens: BoardArray; // length 81
  // NOTE: `solution` is intentionally not on this type. The client never receives it.
}

/** A move applied to a board. Discriminated union by `kind`. */
export type Move =
  | { kind: 'value'; cell: CellIndex; value: CellValue }
  | { kind: 'clear'; cell: CellIndex }
  | { kind: 'note_toggle'; cell: CellIndex; value: CellValue };

/** A move as persisted on the server, with sequence number and author. */
export interface PersistedMove {
  readonly seq: number;
  readonly playerId: PlayerId;
  readonly move: Move;
  readonly createdAt: string; // ISO timestamp
}
