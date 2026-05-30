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

/** Drop the cached name (e.g. on sign-out) so the next `getUsername()` re-reads
 *  the server row for whatever identity is now current. */
export function clearCachedUsername(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {}
}

/**
 * Change the signed-in user's username via the `set-username` Edge Function
 * ([DECISIONS #0043]). `base` is the desired name; the server returns the full
 * display string (`base` or `base#NNNN` if the base collides). Anonymous
 * callers get `forbidden` — the UI should route them to sign-in first.
 *
 * On success the local cache is updated to the returned display string.
 */
export async function setUsername(
  base: string,
): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  const client = await ensureAuthClient();
  if (!client) return { ok: false, error: 'offline' };
  const { data, error } = await client.functions.invoke('set-username', {
    body: { username: base },
  });
  if (error) {
    // A FunctionsHttpError carries the raw Response as `error.context` (see
    // rooms.ts for the same parsing). The body is { error: { code, message } }.
    let message = error.message || 'Could not change username';
    try {
      const ctx = (error as { context?: unknown }).context;
      const response =
        ctx instanceof Response
          ? ctx
          : (ctx as { response?: Response } | undefined)?.response;
      if (response) {
        const parsed = (await response.clone().json()) as { error?: { message?: string } };
        if (parsed?.error?.message) message = parsed.error.message;
      }
    } catch {}
    return { ok: false, error: message };
  }
  if (!data?.username) return { ok: false, error: 'Could not change username' };
  const username = data.username as string;
  try {
    window.localStorage.setItem(KEY, username);
  } catch {}
  return { ok: true, username };
}
