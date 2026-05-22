'use client';

import { useEffect } from 'react';
import { useGameStore } from '@/lib/game-store';
import type { CellValue } from '@sudoku-squad/core';

/**
 * Wires physical keyboard input into the game store.
 *
 *   1..9              — enter value (or toggle a pencil-mark in notes mode)
 *   Shift+1..9        — one-shot pencil-mark toggle, regardless of mode
 *   0 / Backspace / Delete — clear the cell
 *   Arrows            — move selection
 *   Space             — toggle notes mode
 *   N                 — toggle notes mode (legacy alias)
 *   Cmd/Ctrl+Z        — undo
 *   Cmd/Ctrl+Shift+Z  — redo
 *   Cmd/Ctrl+Y        — redo
 *   ?                 — open the keyboard shortcuts overlay
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
      // Shift+digit: one-shot pencil-mark, regardless of notesMode. Check
      // BEFORE the plain-digit branch so Shift+1 doesn't fall through.
      if (e.shiftKey && /^[1-9]$/.test(key)) {
        e.preventDefault();
        store.enterNote(Number(key) as CellValue);
        return;
      }
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
      // Tab: like ArrowRight but wraps within the row (col 8 → col 0 of the
      // same row). Doesn't cross row boundaries. preventDefault so the focus
      // doesn't escape the grid.
      if (key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const cur = store.selected ?? 0;
        const row = Math.floor(cur / 9);
        const col = cur % 9;
        store.selectCell(row * 9 + ((col + 1) % 9));
        return;
      }
      // Spacebar: toggle notes mode. preventDefault so the page doesn't scroll.
      if (key === ' ' || key === 'Spacebar') {
        e.preventDefault();
        store.toggleNotesMode();
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
