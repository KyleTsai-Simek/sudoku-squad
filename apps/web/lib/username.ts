'use client';

/**
 * Remember the player's last-used username in localStorage so they don't have
 * to retype it every room. First-time visitors get an auto-generated handle.
 *
 * Per-device (no sync), same as `solved-tracker`.
 */

const KEY = 'sudokusquad:username';

const RANDOM_ADJECTIVES = [
  'quick', 'silent', 'cosmic', 'sunny', 'mellow', 'tidy', 'lucky', 'jolly',
  'sneaky', 'bold', 'witty', 'royal', 'snazzy', 'cozy', 'wild',
];
const RANDOM_NOUNS = [
  'fox', 'panda', 'owl', 'otter', 'whale', 'crow', 'badger', 'wolf', 'hawk',
  'lynx', 'tiger', 'bison', 'moose', 'heron', 'gecko',
];

function randomGuestName(): string {
  const a = RANDOM_ADJECTIVES[Math.floor(Math.random() * RANDOM_ADJECTIVES.length)];
  const n = RANDOM_NOUNS[Math.floor(Math.random() * RANDOM_NOUNS.length)];
  const d = Math.floor(Math.random() * 90 + 10); // 10..99
  return `${a}-${n}-${d}`;
}

/** Returns the stored username or generates a fresh one and persists it. */
export function getOrCreateUsername(): string {
  if (typeof window === 'undefined') return 'guest';
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored && stored.length > 0 && stored.length <= 20) return stored;
  } catch {}
  const fresh = randomGuestName();
  try {
    window.localStorage.setItem(KEY, fresh);
  } catch {}
  return fresh;
}

export function setUsername(name: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = name.trim().slice(0, 20);
  if (trimmed.length === 0) return;
  try {
    window.localStorage.setItem(KEY, trimmed);
  } catch {}
}
