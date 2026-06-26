'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { AccountIcon, MenuIcon } from './material-icons';
import { AuthSheet } from './auth-sheet';
import { UsernameSheet } from './username-sheet';

type Overlay = 'none' | 'auth' | 'username';

/**
 * Global top-corner menu ([DECISIONS #0043]). Mounted once in the root layout so
 * it appears on every screen (/, /play, /r). For now it holds a single Account
 * item: "Sign in" when signed out, the username (→ change / sign out) when
 * signed in. This is also the single place that boots the auth store.
 */
export function AppHeader() {
  const init = useAuthStore((s) => s.init);
  const isAnonymous = useAuthStore((s) => s.isAnonymous);
  const username = useAuthStore((s) => s.username);
  const email = useAuthStore((s) => s.email);
  const mergeError = useAuthStore((s) => s.mergeError);
  const retryProgressMerge = useAuthStore((s) => s.retryProgressMerge);
  const signOut = useAuthStore((s) => s.signOut);

  const [open, setOpen] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [retryingMerge, setRetryingMerge] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  const signedIn = !isAnonymous;

  return (
    <>
      <div className="fixed right-3 top-3 z-40">
        <button
          type="button"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-stone-200 bg-white/90 text-stone-700 shadow-sm backdrop-blur hover:bg-white hover:text-stone-900"
        >
          <MenuIcon size={22} />
        </button>

        {open ? (
          <>
            {/* click-away backdrop */}
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 -z-10 cursor-default"
            />
            <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
              <div className="flex items-center gap-2 px-3 py-2 text-stone-700">
                <AccountIcon size={20} className="shrink-0 text-stone-400" />
                <div className="min-w-0">
                  {signedIn ? (
                    <>
                      <div className="truncate text-sm font-medium text-stone-900">
                        {username ?? 'Account'}
                      </div>
                      {email ? <div className="truncate text-xs text-stone-500">{email}</div> : null}
                    </>
                  ) : (
                    <div className="text-sm font-medium text-stone-900">Account</div>
                  )}
                </div>
              </div>

              <div className="my-1 h-px bg-stone-100" />

              {mergeError ? (
                <div className="border-b border-amber-100 bg-amber-50 px-3 py-2">
                  <p className="mb-2 text-xs text-amber-800">{mergeError}</p>
                  <button
                    type="button"
                    disabled={retryingMerge}
                    onClick={async () => {
                      setRetryingMerge(true);
                      await retryProgressMerge();
                      setRetryingMerge(false);
                    }}
                    className="text-xs font-medium text-amber-900 hover:text-amber-700 disabled:opacity-60"
                  >
                    {retryingMerge ? 'Retrying…' : 'Retry progress merge'}
                  </button>
                </div>
              ) : null}

              {signedIn ? (
                <>
                  <MenuItem
                    label="Change username"
                    onClick={() => {
                      setOpen(false);
                      setOverlay('username');
                    }}
                  />
                  <MenuItem
                    label="Sign out"
                    onClick={() => {
                      setOpen(false);
                      void signOut();
                    }}
                  />
                </>
              ) : (
                <MenuItem
                  label="Sign in"
                  onClick={() => {
                    setOpen(false);
                    setOverlay('auth');
                  }}
                />
              )}
            </div>
          </>
        ) : null}
      </div>

      {overlay === 'auth' ? <AuthSheet onClose={() => setOverlay('none')} /> : null}
      {overlay === 'username' ? (
        <UsernameSheet current={username} onClose={() => setOverlay('none')} />
      ) : null}
    </>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-50 hover:text-stone-900"
    >
      {label}
    </button>
  );
}
