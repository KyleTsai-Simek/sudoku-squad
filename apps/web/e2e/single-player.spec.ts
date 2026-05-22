import { expect, test } from '@playwright/test';

/**
 * Single-player happy-path smoke. Uses a bundled sample puzzle so it runs
 * without Supabase env (loadPuzzle's bundled-fallback path handles it).
 *
 *  1. Home renders.
 *  2. Navigating to /play/<sample-code> mounts the board.
 *  3. Hitting Hint enough times completes the puzzle.
 *  4. Completion overlay appears with the "Nicely done." headline.
 *
 * This is the load-bearing regression test for Phase 1. Keep it green.
 */

// Pinned sample code from apps/web/lib/sample-puzzles.ts (sample-1, easy).
const SAMPLE_CODE = '3santv';

test('single-player: solve via hints to completion', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sudoku Squad' })).toBeVisible();

  await page.goto(`/play/${SAMPLE_CODE}`);
  await expect(page.getByRole('grid', { name: 'Sudoku board' })).toBeVisible();
  // First sample puzzle: row 1 column 1 is a given 5.
  await expect(
    page.getByRole('gridcell', { name: /row 1, column 1, value 5, given/ }),
  ).toBeVisible();

  const hint = page.getByRole('button', { name: 'Hint' });
  for (let i = 0; i < 90; i++) {
    if (await page.getByRole('dialog', { name: 'Puzzle complete' }).isVisible()) break;
    if (!(await hint.isEnabled())) break;
    await hint.click();
  }

  const overlay = page.getByRole('dialog', { name: 'Puzzle complete' });
  await expect(overlay).toBeVisible();
  await expect(overlay.getByText('Nicely done.')).toBeVisible();
  await expect(overlay.getByRole('button', { name: /Play another/ })).toBeVisible();
});
