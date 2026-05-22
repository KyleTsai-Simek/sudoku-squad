/**
 * Core domain types for Sudoku Squad.
 *
 * Conventions:
 *  - Cell indices are 0..80, row-major. Row 0 = top, col 0 = left.
 *  - Cell values are 1..9. We use 0 to mean "empty" in compact representations
 *    (e.g., 81-int arrays from the dataset), and `null` in BoardState for clarity.
 *  - Notes are sets of 1..9, represented as a small bitmask for compactness.
 *  - A puzzle has two identifiers: the database UUID (`PuzzleId`, internal) and
 *    the short URL-friendly hash (`PuzzleCode`, external). The code is the
 *    cross-mode primitive — URLs, sharing, and `rooms.puzzle_code` all use it.
 *    See docs/DECISIONS.md #0019 and #0020.
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
  /** Short base36 hash; the same identifier the URL carries. */
  readonly puzzleCode: PuzzleCode;
  readonly cells: Cell[]; // length 81
}

/** Internal DB key. UUIDs in Supabase. Use sparingly — prefer PuzzleCode. */
export type PuzzleId = string;
/** External 6-char lowercase base36 hash of `givens`. Used in URLs and as the FK across modes. */
export type PuzzleCode = string;
export type PlayerId = string;
export type RoomId = string;
/** Short shareable code for a multiplayer room. Format per docs/DECISIONS.md #0021. */
export type RoomCode = string;

export type Difficulty = 'warmup' | 'easy' | 'medium' | 'hard' | 'expert' | 'killer';

/** Ordered easiest-to-hardest. Useful for UI lists. `killer` is the hidden
 *  top tier — present in the data and the type so the DB can hold it, but
 *  intentionally not surfaced via the home-page picker yet. See
 *  docs/DECISIONS.md #0034. */
export const DIFFICULTIES_ORDERED: ReadonlyArray<Difficulty> = [
  'warmup',
  'easy',
  'medium',
  'hard',
  'expert',
  'killer',
];

/** Difficulty tiers exposed in the UI (home-page picker, battle/coop CTAs).
 *  Excludes `killer` which stays hidden for now. */
export const DIFFICULTIES_VISIBLE: ReadonlyArray<Difficulty> = [
  'warmup',
  'easy',
  'medium',
  'hard',
  'expert',
];

export interface Puzzle {
  readonly id: PuzzleId;
  readonly code: PuzzleCode;
  readonly difficulty: Difficulty;
  readonly givens: BoardArray; // length 81
  // NOTE: `solution` is intentionally not on this type. The client never receives it
  // in multiplayer. Single-player uses an SP-only RPC that returns the full row — see
  // docs/DECISIONS.md #0019 / #0022.
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
