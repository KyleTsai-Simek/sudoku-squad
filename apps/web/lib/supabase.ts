import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Shared anon Supabase client for the web app.
 *
 * We lazily construct it so that environments without Supabase env vars
 * (notably the Playwright smoke) can still render the bundled puzzle path
 * without crashing on import. Callers that depend on the client check
 * `hasSupabase()` first.
 */
let _client: SupabaseClient | null = null;
let _checked = false;

export function hasSupabase(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function getSupabase(): SupabaseClient | null {
  if (_checked) return _client;
  _checked = true;
  if (!hasSupabase()) return null;
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false },
    },
  );
  return _client;
}
