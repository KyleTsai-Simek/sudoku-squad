'use client';

/**
 * localStorage-backed set of puzzle codes the player has solved. Used to
 * avoid serving the same puzzle twice on "new game".
 *
 * Per-device. We don't sync this — see DECISIONS.md #0006 (no accounts in V1).
 * If localStorage is unavailable (e.g. SSR), this degrades to an empty set.
 */

const KEY = 'sudokusquad:solved';

export function getSolvedSet(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

export function markSolved(code: string): void {
  if (typeof window === 'undefined') return;
  const set = getSolvedSet();
  if (set.has(code)) return;
  set.add(code);
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // Ignore quota / privacy-mode errors. Worst case the player sees a puzzle
    // again — not a correctness issue.
  }
}

export function clearSolved(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {}
}
