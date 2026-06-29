import { expect, test } from '@playwright/test';

/**
 * Single-player durable-resume regression (DECISIONS #0040, b1). Fills a couple
 * of cells, reloads the page, and asserts the in-progress game auto-resumes
 * from localStorage instead of resetting. Uses the bundled sample puzzle so it
 * runs without Supabase env (same as single-player.spec.ts) and in CI.
 */

const SAMPLE_CODE = '3santv';

test('single-player: in-progress game auto-resumes after reload', async ({ page }) => {
  await page.goto(`/play/${SAMPLE_CODE}`);
  await expect(page.getByRole('grid', { name: 'Sudoku board' })).toBeVisible();

  // Fill two empty cells (row1col3 and row5col5). Values are arbitrary; we
  // only care that they survive a reload.
  await page.getByRole('gridcell', { name: /row 1, column 3, empty/ }).click();
  await page.keyboard.press('4');
  await page.getByRole('gridcell', { name: /row 5, column 5, empty/ }).click();
  await page.keyboard.press('5');

  // Confirm they landed before reloading.
  await expect(page.getByRole('gridcell', { name: /row 1, column 3, value 4/ })).toBeVisible();
  await expect(page.getByRole('gridcell', { name: /row 5, column 5, value 5/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('grid', { name: 'Sudoku board' })).toBeVisible();

  // Both entries persist across the reload (auto-resume, no prompt)...
  await expect(page.getByRole('gridcell', { name: /row 1, column 3, value 4/ })).toBeVisible();
  await expect(page.getByRole('gridcell', { name: /row 5, column 5, value 5/ })).toBeVisible();
  // ...and a cell we never touched is still empty.
  await expect(page.getByRole('gridcell', { name: /row 1, column 4, empty/ })).toBeVisible();
});

test('single-player: returning after task switching shows a paused resume gate', async ({ page }) => {
  await page.goto(`/play/${SAMPLE_CODE}`);
  await expect(page.getByRole('grid', { name: 'Sudoku board' })).toBeVisible();

  await page.getByRole('gridcell', { name: /row 1, column 3, empty/ }).click();
  await page.keyboard.press('4');
  await expect(page.getByRole('gridcell', { name: /row 1, column 3, value 4/ })).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(5_100);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await expect(page.getByRole('dialog', { name: 'Ready to continue?' })).toBeVisible();

  await page.keyboard.press('5');
  await expect(page.getByRole('gridcell', { name: /row 1, column 3, value 4/ })).toBeVisible();

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('dialog', { name: 'Ready to continue?' })).toBeHidden();

  await page.keyboard.press('5');
  await expect(page.getByRole('gridcell', { name: /row 1, column 3, value 5/ })).toBeVisible();
});
