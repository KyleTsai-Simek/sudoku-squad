'use client';

import { useEffect } from 'react';
import { useGameStore } from '@/lib/game-store';
import type { CellValue } from '@sudoku-squad/core';

/**
 * Wires physical keyboard input into the game store.
 * 1..9 — enter value (or toggle note when notesMode is on)
 * 0 / Backspace / Delete — clear the cell
 * Arrows — move selection
 * N — toggle notes mode
 * Ctrl/Cmd+Z — undo; Ctrl/Cmd+Shift+Z or Ctrl+Y — redo
 *
 * Renders nothing.
 */
export function KeyboardController() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const store = useGameStore.getState();
      if (!store.board) return;
      // Don't hijack typing in inputs.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return;
      }

      const key = e.key;
      if (/^[1-9]$/.test(key)) {
        e.preventDefault();
        store.enterValue(Number(key) as CellValue);
        return;
      }
      if (key === '0' || key === 'Backspace' || key === 'Delete') {
        e.preventDefault();
        store.clearCell();
        return;
      }
      if (key === 'ArrowUp') {
        e.preventDefault();
        store.moveSelection(0, -1);
        return;
      }
      if (key === 'ArrowDown') {
        e.preventDefault();
        store.moveSelection(0, 1);
        return;
      }
      if (key === 'ArrowLeft') {
        e.preventDefault();
        store.moveSelection(-1, 0);
        return;
      }
      if (key === 'ArrowRight') {
        e.preventDefault();
        store.moveSelection(1, 0);
        return;
      }
      if (key === 'n' || key === 'N') {
        e.preventDefault();
        store.toggleNotesMode();
        return;
      }
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
