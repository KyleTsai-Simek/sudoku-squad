'use client';

import { useEffect } from 'react';
import { useBattleStore } from '@/lib/battle-store';
import type { CellValue } from '@sudoku-squad/core';

/**
 * Battle equivalent of `keyboard-controller.tsx`. Same key bindings; routes
 * actions to `useBattleStore` instead of `useGameStore`. See that file for
 * the full bindings table.
 */
export function BattleKeyboardController() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const store = useBattleStore.getState();
      if (!store.board) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return;
      }

      const key = e.key;
      if (e.shiftKey && /^[1-9]$/.test(key)) {
        e.preventDefault();
        void store.enterNote(Number(key) as CellValue);
        return;
      }
      if (/^[1-9]$/.test(key)) {
        e.preventDefault();
        void store.enterValue(Number(key) as CellValue);
        return;
      }
      if (key === '0' || key === 'Backspace' || key === 'Delete') {
        e.preventDefault();
        void store.clearCell();
        return;
      }
      if (key === 'ArrowUp') { e.preventDefault(); store.moveSelection(0, -1); return; }
      if (key === 'ArrowDown') { e.preventDefault(); store.moveSelection(0, 1); return; }
      if (key === 'ArrowLeft') { e.preventDefault(); store.moveSelection(-1, 0); return; }
      if (key === 'ArrowRight') { e.preventDefault(); store.moveSelection(1, 0); return; }
      if (key === 'Tab' && !e.shiftKey) {
        // Tab = ArrowRight + wrap col 8→0 within the same row.
        e.preventDefault();
        const cur = store.selected ?? 0;
        const row = Math.floor(cur / 9);
        const col = cur % 9;
        store.selectCell(row * 9 + ((col + 1) % 9));
        return;
      }
      if (key === ' ' || key === 'Spacebar') {
        e.preventDefault();
        store.toggleNotesMode();
        return;
      }
      if (key === 'n' || key === 'N') { e.preventDefault(); store.toggleNotesMode(); return; }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (key === 'z' || key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && (key === 'y' || key === 'Y')) {
        e.preventDefault();
        store.redo();
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return null;
}
