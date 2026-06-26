'use client';

import { create } from 'zustand';
import { invalidateCompletionsCache } from './completions';
import { ensureAuthClient, getSupabase } from './supabase';
import { clearCachedUsername, getUsername, readCachedUsername } from './username';

/**
 * Auth state + email sign-in flow ([DECISIONS #0043]).
 *
 * Anonymous is always the default identity. "Signing in" *links* an email to
 * the current anonymous user:
 *   - New email → `updateUser({ email })` promotes the anon user in place
 *     (same auth.uid(), progress + username preserved). Verify type 'email_change'.
 *   - Existing email → `updateUser` fails, so we `signInWithOtp` into the
 *     existing account (a different uid) and then call `merge-progress` with the
 *     anon token we stashed before the session flipped, to union the device's
 *     anonymous progress into the account. Verify type 'email'.
 *
 * Both the magic link and the numeric code come from the same email; the code
 * path is the primary UX (no redirect). The code length is a Supabase
 * project-level setting (currently 6 digits, the default).
 */

type PendingMode = 'link' | 'signin';
type CallbackOtpType = 'email' | 'email_change' | 'signup' | 'magiclink';

interface AuthState {
  ready: boolean;
  userId: string | null;
  isAnonymous: boolean;
  email: string | null;
  username: string | null;
  /** True once an email OTP/link has been requested and we're awaiting a code. */
  awaitingCode: boolean;
  /** Recoverable warning when an existing-account progress merge fails. */
  mergeError: string | null;

  init: () => Promise<void>;
  refreshUsername: () => Promise<void>;
  startEmailAuth: (email: string) => Promise<{ ok: boolean; error?: string }>;
  verifyCode: (
    email: string,
    token: string,
  ) => Promise<{ ok: boolean; error?: string; warning?: string }>;
  cancelEmailAuth: () => void;
  /** Finish a magic-link sign-in after the redirect to /auth/callback. */
  completeMagicLink: () => Promise<{ ok: boolean; error?: string; warning?: string }>;
  retryProgressMerge: () => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  applyUsername: (username: string) => void;
}

// Module-scoped (not in the store) so they never leak into rendered state.
let pendingMode: PendingMode | null = null;
let stashedAnonToken: string | null = null;
let listenerBound = false;

// Mirrored to localStorage so the magic-link path — which reloads the page on a
// fresh navigation and loses the module vars — can still complete the merge.
const SRC_TOKEN_KEY = 'sudokusquad:auth:srcToken';
const MODE_KEY = 'sudokusquad:auth:mode';

function persistPending(mode: PendingMode, srcToken: string | null): void {
  pendingMode = mode;
  stashedAnonToken = srcToken;
  try {
    window.localStorage.setItem(MODE_KEY, mode);
    if (srcToken) window.localStorage.setItem(SRC_TOKEN_KEY, srcToken);
  } catch {}
}

function clearPending(): void {
  pendingMode = null;
  stashedAnonToken = null;
  try {
    window.localStorage.removeItem(MODE_KEY);
    window.localStorage.removeItem(SRC_TOKEN_KEY);
  } catch {}
}

function isCallbackOtpType(type: string): type is CallbackOtpType {
  return type === 'email' || type === 'email_change' || type === 'signup' || type === 'magiclink';
}

async function mergeProgress(
  client: NonNullable<ReturnType<typeof getSupabase>>,
  sourceToken: string,
): Promise<string | null> {
  const res = await client.functions.invoke('merge-progress', {
    body: { source_token: sourceToken },
  });
  if (res.error) return res.error.message;
  return null;
}

async function refreshLandedIdentity(
  client: NonNullable<ReturnType<typeof getSupabase>>,
  set: (partial: Partial<AuthState>) => void,
  refreshUsername: () => Promise<void>,
): Promise<void> {
  const { data } = await client.auth.getUser();
  invalidateCompletionsCache();
  clearCachedUsername();
  set({
    awaitingCode: false,
    userId: data.user?.id ?? null,
    isAnonymous: data.user?.is_anonymous ?? false,
    email: data.user?.email ?? null,
  });
  await refreshUsername();
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ready: false,
  userId: null,
  isAnonymous: true,
  email: null,
  username: typeof window !== 'undefined' ? readCachedUsername() : null,
  awaitingCode: false,
  mergeError: null,

  init: async () => {
    if (get().ready) return;
    const client = await ensureAuthClient();
    if (!client) {
      set({ ready: true });
      return;
    }
    const { data } = await client.auth.getUser();
    set({
      ready: true,
      userId: data.user?.id ?? null,
      isAnonymous: data.user?.is_anonymous ?? false,
      email: data.user?.email ?? null,
    });
    // Keep userId/email/anon fresh across sign-in / sign-out / user-update.
    if (!listenerBound) {
      listenerBound = true;
      client.auth.onAuthStateChange((_event, session) => {
        invalidateCompletionsCache();
        set({
          userId: session?.user?.id ?? null,
          isAnonymous: session?.user?.is_anonymous ?? false,
          email: session?.user?.email ?? null,
        });
      });
    }
    await get().refreshUsername();
  },

  refreshUsername: async () => {
    // claim-username is idempotent per uid: for an existing identity it returns
    // the current name; for a brand-new anon it issues one. So this both reads
    // and lazily provisions.
    const username = await getUsername();
    set({ username });
  },

  startEmailAuth: async (email) => {
    const client = await ensureAuthClient();
    if (!client) return { ok: false, error: 'Sign-in is unavailable here.' };

    // Stash the current anon token before anything can replace the session —
    // needed to merge if this turns out to be an existing account.
    const { data: sess } = await client.auth.getSession();
    stashedAnonToken = sess.session?.access_token ?? null;

    const redirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined;

    // Try linking the email to the current anonymous user.
    const link = await client.auth.updateUser(
      { email },
      redirectTo ? { emailRedirectTo: redirectTo } : undefined,
    );
    if (!link.error) {
      persistPending('link', stashedAnonToken);
      set({ awaitingCode: true });
      return { ok: true };
    }

    // Email already maps to an account → sign into it; merge happens on verify.
    const signin = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
    });
    if (!signin.error) {
      persistPending('signin', stashedAnonToken);
      set({ awaitingCode: true });
      return { ok: true };
    }
    return { ok: false, error: signin.error.message };
  },

  verifyCode: async (email, token) => {
    const client = getSupabase();
    if (!client) return { ok: false, error: 'Sign-in is unavailable here.' };

    const type = pendingMode === 'signin' ? 'email' : 'email_change';
    const res = await client.auth.verifyOtp({ email, token, type });
    if (res.error) return { ok: false, error: res.error.message };

    // Existing-account path: union the abandoned anon identity's progress.
    if (pendingMode === 'signin' && stashedAnonToken) {
      const mergeError = await mergeProgress(client, stashedAnonToken);
      await refreshLandedIdentity(client, set, get().refreshUsername);
      if (mergeError) {
        const warning =
          'You are signed in, but anonymous progress did not finish merging. You can retry from the Account menu.';
        set({ mergeError: warning });
        return { ok: true, warning };
      }
      clearPending();
      set({ mergeError: null });
      return { ok: true };
    }

    clearPending();
    set({ mergeError: null });
    await refreshLandedIdentity(client, set, get().refreshUsername);
    return { ok: true };
  },

  cancelEmailAuth: () => {
    clearPending();
    set({ awaitingCode: false });
  },

  completeMagicLink: async () => {
    const client = getSupabase();
    if (!client) return { ok: false, error: 'Sign-in is unavailable here.' };

    // Two link shapes land here: PKCE `?code=...` (signInWithOtp magic links)
    // and `?token_hash=...&type=...` (email-change confirmations). Handle both.
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const tokenHash = params.get('token_hash');
    const linkType = params.get('type');
    if (code) {
      const ex = await client.auth.exchangeCodeForSession(code);
      if (ex.error) return { ok: false, error: ex.error.message };
    } else if (tokenHash && linkType) {
      if (!isCallbackOtpType(linkType)) {
        return { ok: false, error: `Unsupported sign-in link type: ${linkType}` };
      }
      const v = await client.auth.verifyOtp({
        token_hash: tokenHash,
        type: linkType,
      });
      if (v.error) return { ok: false, error: v.error.message };
    }

    // Recover the pending mode/token mirrored to localStorage before the redirect.
    let mode: PendingMode | null = pendingMode;
    let srcToken: string | null = stashedAnonToken;
    try {
      mode = (window.localStorage.getItem(MODE_KEY) as PendingMode | null) ?? mode;
      srcToken = window.localStorage.getItem(SRC_TOKEN_KEY) ?? srcToken;
    } catch {}

    if (mode === 'signin' && srcToken) {
      const mergeError = await mergeProgress(client, srcToken);
      await refreshLandedIdentity(client, set, get().refreshUsername);
      if (mergeError) {
        const warning =
          'You are signed in, but anonymous progress did not finish merging. You can retry from the Account menu.';
        set({ mergeError: warning });
        return { ok: true, warning };
      }
      clearPending();
      set({ mergeError: null });
      return { ok: true };
    }

    clearPending();
    set({ mergeError: null });
    await refreshLandedIdentity(client, set, get().refreshUsername);
    return { ok: true };
  },

  retryProgressMerge: async () => {
    const client = getSupabase();
    if (!client) return { ok: false, error: 'Sign-in is unavailable here.' };

    let srcToken: string | null = stashedAnonToken;
    try {
      srcToken = window.localStorage.getItem(SRC_TOKEN_KEY) ?? srcToken;
    } catch {}
    if (!srcToken) {
      set({ mergeError: null });
      return { ok: false, error: 'No pending progress merge was found.' };
    }

    const mergeError = await mergeProgress(client, srcToken);
    if (mergeError) {
      const message = 'Progress merge failed again. Check your connection and try once more.';
      set({ mergeError: message });
      return { ok: false, error: message };
    }

    clearPending();
    invalidateCompletionsCache();
    set({ mergeError: null });
    return { ok: true };
  },

  signOut: async () => {
    const client = getSupabase();
    if (!client) return;
    await client.auth.signOut();
    invalidateCompletionsCache();
    clearCachedUsername();
    // Return to a fresh anonymous identity so play continues seamlessly.
    await client.auth.signInAnonymously();
    const { data } = await client.auth.getUser();
    set({
      userId: data.user?.id ?? null,
      isAnonymous: data.user?.is_anonymous ?? false,
      email: data.user?.email ?? null,
      username: null,
      mergeError: null,
    });
    await get().refreshUsername();
  },

  applyUsername: (username) => set({ username }),
}));
