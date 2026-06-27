import { expect, test } from '@playwright/test';

/**
 * Single-player happy-path smoke. Uses a bundled sample puzzle so it runs
 * without Supabase env (loadPuzzle's bundled-fallback path handles it).
 *
 *  1. Home renders.
 *  2. Navigating to /play/<sample-code> mounts the board.
 *  3. The test fills the solution cell-by-cell via keyboard.
 *  4. Completion overlay appears with the "You won!" headline.
 *
 * This is the load-bearing regression test for Phase 1. Keep it green.
 */

// Pinned sample-1 from apps/web/lib/sample-puzzles.ts (medium).
const SAMPLE_CODE = '3santv';
const GIVENS =
  '53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79';
const SOLUTION =
  '534678912672195348198342567859761423426853791713924856961537284287419635345286179';

test('single-player: solve to completion via keyboard', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sudoku Squad' })).toBeVisible();

  await page.goto(`/play/${SAMPLE_CODE}`);
  await expect(page.getByRole('grid', { name: 'Sudoku board' })).toBeVisible();
  await expect(
    page.getByRole('gridcell', { name: /row 1, column 1, value 5, given/ }),
  ).toBeVisible();

  // Click each empty cell and type its solution digit.
  for (let i = 0; i < 81; i++) {
    if (GIVENS[i] !== '.' && GIVENS[i] !== '0') continue;
    const row = Math.floor(i / 9) + 1;
    const col = (i % 9) + 1;
    await page
      .getByRole('gridcell', { name: new RegExp(`row ${row}, column ${col}, empty`) })
      .click();
    await page.keyboard.press(SOLUTION[i]!);
  }

  const overlay = page.getByRole('dialog', { name: 'Puzzle complete' });
  await expect(overlay).toBeVisible();
  await expect(overlay.getByText('You won!')).toBeVisible();
  await expect(overlay.getByRole('button', { name: /Play another/ })).toBeVisible();
  await overlay.getByRole('button', { name: 'Share' }).click();
  await expect(overlay.getByRole('button', { name: 'Copied share link' })).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain('Try this Medium Sudoku Squad puzzle.');
  const shareUrl = clipboard.match(/http:\/\/localhost:\d+\/s\/\S+/)?.[0];
  expect(shareUrl).toBeTruthy();
  await page.goto(shareUrl!);
  await expect(page.getByRole('heading', { name: 'Try this puzzle' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Play this puzzle' })).toHaveAttribute(
    'href',
    `/play/${SAMPLE_CODE}`,
  );
});
