import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/**
 * Service-role client. Bypasses RLS. The Edge Function is authoritative for
 * its mutation — RLS is the second line of defense (in case a function is ever
 * compromised, plain table access from anon is still denied).
 *
 * Read service-role at module scope so we fail fast on missing config.
 */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in Edge Function env');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Caller-scoped client. Used only to validate the caller's JWT and read their
 * `auth.uid()`. Pass the original Authorization header through.
 */
export function callerClient(authHeader: string): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) {
    throw new Error('SUPABASE_URL or SUPABASE_ANON_KEY missing in Edge Function env');
  }
  return createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Resolve the calling user's id from the Authorization header. Returns null if
 * the JWT is missing or invalid. Edge Functions are deployed with JWT
 * verification enabled by default, so a request that gets this far has *some*
 * valid token — we still re-verify to get the user id.
 */
export async function getCallerUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const client = callerClient(auth);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

export interface Caller {
  id: string;
  /** True for Supabase anonymous sessions; false once an email is linked. */
  isAnonymous: boolean;
  email: string | null;
}

/**
 * Like `getCallerUserId` but also surfaces whether the caller is anonymous and
 * their email. Used by `set-username` (renames are signed-in-only) and
 * `merge-progress` (the source identity must be anonymous).
 */
export async function getCaller(req: Request): Promise<Caller | null> {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const client = callerClient(auth);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return {
    id: data.user.id,
    isAnonymous: data.user.is_anonymous ?? false,
    email: data.user.email ?? null,
  };
}

/**
 * Resolve a user from an arbitrary access token (not the request's
 * Authorization header). Used by `merge-progress` to validate the *source*
 * anonymous identity, whose token the client captures before it's replaced by
 * the destination-account session.
 */
export async function getUserFromToken(token: string): Promise<Caller | null> {
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) {
    throw new Error('SUPABASE_URL or SUPABASE_ANON_KEY missing in Edge Function env');
  }
  const client = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return {
    id: data.user.id,
    isAnonymous: data.user.is_anonymous ?? false,
    email: data.user.email ?? null,
  };
}
