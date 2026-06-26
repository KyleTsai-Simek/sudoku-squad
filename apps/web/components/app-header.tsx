'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth-store';
import { getThemeOptions, type ThemePreference, useThemePreference } from '@/lib/theme-store';
import { AccountIcon, MenuIcon } from './material-icons';
import { UsernameSheet } from './username-sheet';

type Overlay = 'none' | 'username';

interface AppHeaderProps {
  left?: ReactNode;
  center?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function AppHeader({ left, center, actions, className = '' }: AppHeaderProps) {
  const init = useAuthStore((s) => s.init);
  const isAnonymous = useAuthStore((s) => s.isAnonymous);
  const username = useAuthStore((s) => s.username);
  const email = useAuthStore((s) => s.email);
  const mergeError = useAuthStore((s) => s.mergeError);
  const retryProgressMerge = useAuthStore((s) => s.retryProgressMerge);
  const signOut = useAuthStore((s) => s.signOut);
  const { preference: themePreference, setPreference: setThemePreference } = useThemePreference();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [retryingMerge, setRetryingMerge] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  const signedIn = !isAnonymous;
  const accountLabel = username ?? 'Account';

  return (
    <>
      <header
        className={`grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 ${className}`}
      >
        <div className="min-w-0 justify-self-start">{left}</div>
        <div className="min-w-0 justify-self-center text-center">{center}</div>
        <div className="relative z-40 flex min-w-0 items-center justify-end gap-2 justify-self-end">
          {actions}
          <button
            type="button"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            <MenuIcon size={22} />
          </button>

          {open ? (
            <>
              <button
                type="button"
                aria-hidden="true"
                tabIndex={-1}
                onClick={() => setOpen(false)}
                className="fixed inset-0 -z-10 cursor-default"
              />
              <div className="absolute right-0 top-full mt-2 w-60 overflow-hidden rounded-xl border border-border bg-surface-raised py-1 text-left shadow-lg shadow-overlay/10">
                <div className="flex items-center gap-2 px-3 py-2 text-muted">
                  <AccountIcon size={20} className="shrink-0 text-muted" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {accountLabel}
                    </div>
                    {signedIn && email ? (
                      <div className="truncate text-xs text-muted">{email}</div>
                    ) : null}
                  </div>
                </div>

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
                    label="Sign in to save progress"
                    onClick={() => {
                      setOpen(false);
                      const currentPath = `${window.location.pathname}${window.location.search}`;
                      router.push(`/auth/sign-in?next=${encodeURIComponent(currentPath)}`);
                    }}
                  />
                )}

                {mergeError ? (
                  <div className="border-y border-warning-border/40 bg-warning-soft px-3 py-2">
                    <p className="mb-2 text-xs text-foreground">{mergeError}</p>
                    <button
                      type="button"
                      disabled={retryingMerge}
                      onClick={async () => {
                        setRetryingMerge(true);
                        await retryProgressMerge();
                        setRetryingMerge(false);
                      }}
                      className="text-xs font-medium text-foreground hover:text-primary disabled:opacity-60"
                    >
                      {retryingMerge ? 'Retrying...' : 'Retry progress merge'}
                    </button>
                  </div>
                ) : null}

                <div className="my-1 h-px bg-border/70" />

                <div className="px-3 py-2">
                  <div className="mb-1.5 text-xs font-medium uppercase tracking-widest text-muted">
                    Appearance
                  </div>
                  <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-border bg-surface-muted p-0.5">
                    {getThemeOptions().map((option) => (
                      <ThemeOption
                        key={option}
                        option={option}
                        selected={themePreference === option}
                        onSelect={setThemePreference}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </header>

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
      className="block w-full px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
    >
      {label}
    </button>
  );
}

function ThemeOption({
  option,
  selected,
  onSelect,
}: {
  option: ThemePreference;
  selected: boolean;
  onSelect: (preference: ThemePreference) => void;
}) {
  const label = option[0]!.toUpperCase() + option.slice(1);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(option)}
      className={
        selected
          ? 'rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground shadow-sm'
          : 'rounded-md px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface hover:text-foreground'
      }
    >
      {label}
    </button>
  );
}
