import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Shared Supabase client for the web app.
 *
 * We lazily construct it so environments without Supabase env vars (e.g. the
 * Playwright smoke) can still render the bundled-puzzle path without crashing.
 * Callers either:
 *   - use `getSupabase()` for read-only paths that don't need a player identity
 *     (browsing puzzles, calling the SP `sp_get_puzzle` RPC), or
 *   - use `ensureAuthClient()` for multiplayer paths that require a stable
 *     `auth.uid()`. That helper signs the visitor in anonymously and caches
 *     the resulting session in localStorage so refreshes stay the same player.
 */
let _client: SupabaseClient | null = null;
let _checked = false;
let _authPromise: Promise<SupabaseClient | null> | null = null;

export function getSupabase(): SupabaseClient | null {
  if (_checked) return _client;
  _checked = true;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  _client = createClient(url, anon, {
    // Persist the anon session so a refreshed tab is still the same player.
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return _client;
}

/**
 * Idempotent: returns a client whose `auth.getUser()` is populated. Safe to
 * call from many places — the underlying sign-in runs at most once per page.
 */
export function ensureAuthClient(): Promise<SupabaseClient | null> {
  if (_authPromise) return _authPromise;
  _authPromise = (async () => {
    const client = getSupabase();
    if (!client) return null;
    const { data: existing } = await client.auth.getSession();
    if (existing?.session) return client;
    const { error } = await client.auth.signInAnonymously();
    if (error) {
      console.error('signInAnonymously failed', error);
      // Drop the promise so a later call can retry.
      _authPromise = null;
      return null;
    }
    return client;
  })();
  return _authPromise;
}
