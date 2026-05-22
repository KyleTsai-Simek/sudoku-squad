'use client';

import { useEffect, useState } from 'react';
import { useGameStore } from '@/lib/game-store';
import type { GameSettings } from '@/lib/game-store';

const OPTIONS: Array<{
  key: keyof GameSettings;
  label: string;
  description: string;
}> = [
  {
    key: 'showConflicts',
    label: 'Show conflicts',
    description: 'Highlight cells that break sudoku rules (does not use the solution).',
  },
  {
    key: 'autoCheck',
    label: 'Auto-check correctness',
    description: 'Flag wrong entries immediately. Compares to the solution.',
  },
  {
    key: 'highlightSameValue',
    label: 'Highlight same value',
    description: 'When a filled cell is selected, dim other cells with the same value.',
  },
];

export function SettingsSheet() {
  const settings = useGameStore((s) => s.settings);
  const setSetting = useGameStore((s) => s.setSetting);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open settings"
        className="flex h-9 w-9 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
      >
        {/* gear glyph */}
        <span aria-hidden className="text-lg">⚙</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Settings</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close settings"
                className="rounded-md px-2 py-1 text-sm text-stone-500 hover:bg-stone-100"
              >
                Done
              </button>
            </div>
            <ul className="flex flex-col gap-3">
              {OPTIONS.map((opt) => (
                <li key={opt.key} className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-stone-900">{opt.label}</p>
                    <p className="text-xs text-stone-500">{opt.description}</p>
                  </div>
                  <label className="flex shrink-0 cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={settings[opt.key]}
                      onChange={(e) => setSetting(opt.key, e.target.checked)}
                      className="h-5 w-5 cursor-pointer accent-amber-500"
                    />
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
