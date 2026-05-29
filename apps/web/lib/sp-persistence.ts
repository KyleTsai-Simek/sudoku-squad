'use client';

import type { BoardState, MoveHistory } from '@sudoku-squad/core';
import type { FetchedPuzzle } from './puzzle-source';
import { useGameStore } from './game-store';

/**
 * Durable local persistence for the single-player game (DECISIONS #0040, b1).
 *
 * SP runs entirely in memory, so a refresh or crash previously lost the whole
 * game. We persist a snapshot of the in-progress game to localStorage and
 * auto-resume it on reload (no prompt — user decision 2026-05-29).
 *
 * Scope decisions:
 *  - **One slot.** A single key holds the most-recent in-progress SP game,
 *    tagged with its puzzle code. Resume only fires when the URL's code
 *    matches. Bounds storage and matches "resume the game I was playing."
 *  - **In-progress only.** On completion we clear the slot — a finished game
 *    has nothing to resume.
 *  - **Elapsed is preserved, away-time frozen** (user decision): we store
 *    accumulated play time, and on resume rebase `startedAt = now - elapsed`
 *    so the gap between sessions doesn't count.
 *
 * Web-only (localStorage). The shape is plain JSON, so the eventual iOS port
 * can reuse the same snapshot via AsyncStorage.
 */

const KEY = 'sudoku-squad:sp:current';
const VERSION = 2;

interface PersistedGame {
  v: number;
  code: string;
  puzzle: FetchedPuzzle;
  board: BoardState;
  history: MoveHistory;
  /** Accumulated play time (ms) at save, excluding prior away periods. */
  elapsedMs: number;
  hintsUsed: number;
  notesMode: boolean;
  savedAt: number;
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // Private-mode / disabled storage throws on access.
    return null;
  }
}

/** Persist the current store state as the in-progress SP game, if there is
 *  one worth saving. A finished (or absent) game clears the slot instead. */
export function saveCurrentGame(): void {
  const s = storage();
  if (!s) return;
  const { puzzle, board, history, startedAt, finishedAt, hintsUsed, notesMode } =
    useGameStore.getState();
  if (!puzzle || !board || startedAt === null || finishedAt !== null) {
    // Nothing in progress → make sure we don't leave a stale slot around.
    clearSavedGame();
    return;
  }
  const snapshot: PersistedGame = {
    v: VERSION,
    code: puzzle.code,
    puzzle,
    board,
    history,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    hintsUsed,
    notesMode,
    savedAt: Date.now(),
  };
  try {
    s.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // Quota or serialization failure — non-fatal; the game still plays.
  }
}

export function clearSavedGame(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * If a valid in-progress game is saved for `code`, hydrate the store from it
 * and return true. Otherwise return false (caller should start fresh). Rebases
 * `startedAt` so elapsed continues from where it left off.
 */
export function resumeSavedGame(code: string): boolean {
  const s = storage();
  if (!s) return false;
  let raw: string | null;
  try {
    raw = s.getItem(KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  let parsed: PersistedGame;
  try {
    parsed = JSON.parse(raw) as PersistedGame;
  } catch {
    clearSavedGame();
    return false;
  }
  if (
    !parsed ||
    parsed.v !== VERSION ||
    parsed.code !== code ||
    !parsed.puzzle ||
    !parsed.board ||
    !parsed.history
  ) {
    return false;
  }
  const startedAt = Date.now() - Math.max(0, parsed.elapsedMs);
  useGameStore.getState().hydrate({
    puzzle: parsed.puzzle,
    board: parsed.board,
    history: parsed.history,
    startedAt,
    finishedAt: null,
    hintsUsed: parsed.hintsUsed ?? 0,
    notesMode: parsed.notesMode ?? false,
  });
  return true;
}

let installed = false;

/**
 * Install autosave: persist on every board/history/finished change, and on
 * tab-hide (to capture in-session elapsed before the page is backgrounded or
 * closed). Idempotent — safe to call from a component effect on every mount.
 * Returns a cleanup for the visibility listener.
 */
export function installSpAutosave(): () => void {
  if (installed) return () => {};
  installed = true;

  let lastBoard: BoardState | null = null;
  let lastHistory: MoveHistory | null = null;
  let lastFinished: number | null = null;

  const unsub = useGameStore.subscribe((state) => {
    // Only react to game-meaningful changes — skip pure selection/notesMode
    // churn so arrow-key navigation doesn't hammer localStorage.
    if (
      state.board === lastBoard &&
      state.history === lastHistory &&
      state.finishedAt === lastFinished
    ) {
      return;
    }
    lastBoard = state.board;
    lastHistory = state.history;
    lastFinished = state.finishedAt;
    if (state.finishedAt !== null) {
      clearSavedGame();
    } else {
      saveCurrentGame();
    }
  });

  const onVis = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      saveCurrentGame();
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVis);
  }

  return () => {
    unsub();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVis);
    }
    installed = false;
  };
}
