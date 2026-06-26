'use client';

import { useEffect, useState } from 'react';

interface Shortcut {
  keys: string[];
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['↑', '↓', '←', '→'], description: 'Move selection' },
  { keys: ['Tab'], description: 'Next cell (wraps)' },
  { keys: ['1', '–', '9'], description: 'Enter a value' },
  { keys: ['Space'], description: 'Toggle notes mode' },
  { keys: ['Shift', '+', '1', '–', '9'], description: 'Add a note' },
  { keys: ['0', '/', 'Backspace'], description: 'Clear the cell' },
  { keys: ['⌘', '/', 'Ctrl', '+', 'Z'], description: 'Undo' },
  { keys: ['⌘', '/', 'Ctrl', '+', 'Shift', '+', 'Z'], description: 'Redo' },
  { keys: ['?'], description: 'Show this overlay' },
  { keys: ['Esc'], description: 'Close overlay' },
];

/**
 * Self-contained keyboard-shortcut help dialog. Opens on `?` (Shift+/) and
 * closes on Esc or outside-click. Mount once per game view; the trigger
 * button is exported separately as `KeyboardShortcutsButton`.
 *
 * Pure desktop affordance: hidden behind a media query on the trigger button,
 * but the overlay itself works at any width if opened.
 */
export function KeyboardShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't hijack typing in inputs.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener('sudoku-squad:open-shortcuts', onOpen);
    return () => window.removeEventListener('sudoku-squad:open-shortcuts', onOpen);
  }, []);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 px-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-muted"
          >
            Done
          </button>
        </div>
        <div className="divide-y divide-border text-sm">
          {SHORTCUTS.map((s, i) => (
            <ShortcutRow key={i} keys={s.keys} description={s.description} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ShortcutRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <div className="flex items-center gap-4 py-2.5">
      <div className="flex min-w-[8.5rem] flex-wrap items-center gap-1">
        {keys.map((k, i) =>
          k === '+' || k === '/' || k === '–' ? (
            <span key={i} className="text-muted">
              {k}
            </span>
          ) : (
            <Kbd key={i}>{k}</Kbd>
          ),
        )}
      </div>
      <div className="text-muted">{description}</div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.6rem] items-center justify-center rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-xs font-medium text-muted shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      {children}
    </kbd>
  );
}

/**
 * Header trigger button. Hidden on touch-only widths (sm:inline-flex) because
 * keyboard shortcuts aren't useful on mobile. Dispatches a window event the
 * overlay listens for so the trigger and dialog can live in different parts
 * of the tree without prop-drilling.
 */
export function KeyboardShortcutsButton() {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(new CustomEvent('sudoku-squad:open-shortcuts'))
      }
      aria-label="Show keyboard shortcuts"
      title="Keyboard shortcuts (?)"
      className="hidden h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-sm font-medium text-muted hover:bg-surface-muted sm:inline-flex"
    >
      ?
    </button>
  );
}
