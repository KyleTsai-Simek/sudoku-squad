'use client';

import { useEffect, useState } from 'react';

interface Shortcut {
  keys: string[];
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['↑', '↓', '←', '→'], description: 'Move selection' },
  { keys: ['1', '–', '9'], description: 'Enter a value' },
  { keys: ['Shift', '+', '1', '–', '9'], description: 'Toggle a pencil-mark (any mode)' },
  { keys: ['0', '/', 'Backspace'], description: 'Clear the cell' },
  { keys: ['Space'], description: 'Toggle notes mode' },
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 px-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-sm text-stone-500 hover:bg-stone-100"
          >
            Done
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
          {SHORTCUTS.map((s, i) => (
            <ShortcutRow key={i} keys={s.keys} description={s.description} />
          ))}
        </dl>
        <p className="mt-4 text-xs text-stone-500">
          Tip: tapping <Kbd>Space</Kbd> flips between Normal and Notes mode. Use{' '}
          <Kbd>Shift</Kbd>+digit when you only want to drop a single pencil-mark.
        </p>
      </div>
    </div>
  );
}

function ShortcutRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <>
      <dt className="flex flex-wrap items-center gap-1">
        {keys.map((k, i) =>
          k === '+' || k === '/' || k === '–' ? (
            <span key={i} className="text-stone-400">
              {k}
            </span>
          ) : (
            <Kbd key={i}>{k}</Kbd>
          ),
        )}
      </dt>
      <dd className="text-stone-700">{description}</dd>
    </>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.6rem] items-center justify-center rounded border border-stone-300 bg-stone-50 px-1.5 py-0.5 font-mono text-xs font-medium text-stone-700 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
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
      className="hidden h-9 w-9 items-center justify-center rounded-md border border-stone-300 bg-white text-sm font-medium text-stone-700 hover:bg-stone-50 sm:inline-flex"
    >
      ?
    </button>
  );
}
