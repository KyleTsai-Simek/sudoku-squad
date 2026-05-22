'use client';

import { ensureAuthClient } from './supabase';

/**
 * Username resolution.
 *
 * Per [DECISIONS.md #0027], usernames are issued server-side from a wordlist
 * (claim-username Edge Function), unique across all players, and persisted
 * locally in localStorage so refreshes are instant.
 *
 * First call on a fresh device hits the network; subsequent calls are sync.
 * If localStorage is cleared, the same `auth.uid()` recovers the same name
 * (the Edge Function is idempotent per player). If `auth.uid()` is also lost
 * (full reset), the player gets a fresh name.
 *
 * For the common case — the user clicked a button and we need the name now —
 * the lookup is in-memory after the first await. Returns a placeholder while
 * still loading on initial visit (most UI surfaces show "Loading…" or block
 * the button anyway).
 */

const KEY = 'sudokusquad:username';
let inflight: Promise<string> | null = null;

/** Synchronous read of the cached name, or null if not yet claimed. */
export function readCachedUsername(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Returns the player's username. First call may round-trip to the server;
 * later calls are immediate. The call is idempotent — concurrent callers
 * share a single in-flight promise.
 */
export async function getUsername(): Promise<string> {
  const cached = readCachedUsername();
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    const client = await ensureAuthClient();
    if (!client) {
      // Offline / no Supabase env: fall back to a local-only handle so the
      // smoke test + dev-without-env paths still work. Not persisted to the
      // server.
      const guest = `guest-${Math.floor(Math.random() * 9000 + 1000)}`;
      try {
        window.localStorage.setItem(KEY, guest);
      } catch {}
      return guest;
    }
    const { data, error } = await client.functions.invoke('claim-username', {
      body: {},
    });
    if (error || !data?.username) {
      // Don't cache the failure — let a later call retry.
      const guest = `guest-${Math.floor(Math.random() * 9000 + 1000)}`;
      return guest;
    }
    try {
      window.localStorage.setItem(KEY, data.username);
    } catch {}
    return data.username as string;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/**
 * Manually overwrite the local cached name. The server-side `issued_usernames`
 * row stays as-is — display names diverge from the canonical name. We'll fix
 * this when a rename Edge Function lands.
 */
export function setLocalUsernameOverride(name: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = name.trim().slice(0, 20);
  if (trimmed.length === 0) return;
  try {
    window.localStorage.setItem(KEY, trimmed);
  } catch {}
}
