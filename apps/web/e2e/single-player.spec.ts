import { expect, test } from '@playwright/test';

/**
 * Single-player happy-path smoke. Mirrors the manual verification flow:
 *  1. Home renders, Quick Start grid shows the bundled puzzle pack.
 *  2. Clicking a puzzle navigates to /play with the seed in the URL.
 *  3. The 9×9 grid renders and a given cell is read-only-looking.
 *  4. The Hint button can be hammered to fill the entire puzzle.
 *  5. The completion overlay appears with the "Nicely done." headline.
 *
 * This is the load-bearing regression test for Phase 1. If it breaks, the
 * vertical slice is broken — don't paper over it.
 */
test('single-player: solve via hints to completion', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sudoku Squad' })).toBeVisible();
  await page.getByRole('link', { name: /Puzzle 1/ }).click();

  // We should now be on /play with a board rendered.
  await expect(page).toHaveURL(/\/play\?seed=sample-1/);
  await expect(page.getByRole('grid', { name: 'Sudoku board' })).toBeVisible();
  // The first sample puzzle has 5 in row 1, column 1 as a given.
  await expect(
    page.getByRole('gridcell', { name: /row 1, column 1, value 5, given/ }),
  ).toBeVisible();

  // Mash the Hint button until either completion overlay appears or we hit
  // a safe cap. There are at most 81 empties on any sample.
  const hint = page.getByRole('button', { name: 'Hint' });
  for (let i = 0; i < 90; i++) {
    // Hint becomes disabled (or the overlay covers it) once the puzzle is done.
    if (await page.getByRole('dialog', { name: 'Puzzle complete' }).isVisible()) break;
    if (!(await hint.isEnabled())) break;
    await hint.click();
  }

  const overlay = page.getByRole('dialog', { name: 'Puzzle complete' });
  await expect(overlay).toBeVisible();
  await expect(overlay.getByText('Nicely done.')).toBeVisible();
  await expect(overlay.getByRole('button', { name: 'Play another' })).toBeVisible();
});
