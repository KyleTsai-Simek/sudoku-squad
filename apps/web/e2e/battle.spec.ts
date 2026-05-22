import { expect, test } from '@playwright/test';

/**
 * Two-context battle smoke. Drives a battle game through two separate
 * Playwright contexts (each gets its own anon-auth session). Verifies the
 * load-bearing sync paths: room creation, join, lobby sync, start, board
 * convergence, and opponent-progress broadcast.
 *
 * **Requires live Supabase env** (NEXT_PUBLIC_SUPABASE_URL + ANON_KEY in
 * .env.local). The dev server picks these up via the symlink. CI integration
 * is deferred; for local runs see docs/STATUS.md.
 *
 * Scope intentionally stops short of full race-to-completion + late-finish.
 * Those flows can be added once the underlying submit-move latency is
 * better understood (each call is ~1.5s warm; 50 sequential moves takes
 * 75+ seconds to fully land on the server). The sync primitives this test
 * does exercise — Realtime member subscription, lobby→game routing,
 * `submit-move` progress_pct + `room_players` broadcast — are what Phase 3
 * coop will inherit.
 */

const ROOM_CODE_RE = /\/r\/([a-z0-9]{6})/;

test('battle: create + join + start + sync', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    // A creates a battle room via the three-step home flow:
    //   1. click "Battle"  →  2. click "Create game"
    await pageA.goto('/');
    await expect(pageA.getByRole('heading', { name: 'Sudoku Squad' })).toBeVisible();
    await pageA.getByRole('button', { name: /^Battle/ }).click();
    await pageA.getByRole('button', { name: /Create game/i }).click();
    await pageA.waitForURL(ROOM_CODE_RE, { timeout: 15000 });
    const code = pageA.url().match(ROOM_CODE_RE)![1]!;

    // B joins via the Battle → Join game → code input path.
    await pageB.goto('/');
    await pageB.getByRole('button', { name: /^Battle/ }).click();
    await pageB.getByRole('button', { name: /Join game/i }).click();
    await pageB.getByPlaceholder(/code/i).fill(code);
    await pageB.getByRole('button', { name: /^Join$/ }).click();
    await pageB.waitForURL(new RegExp(`/r/${code}`), { timeout: 15000 });

    // Lobby sync: both see the (2/8) player count via Realtime broadcast.
    await expect(pageA.getByText(/\(2\s*\/\s*8\)/)).toBeVisible({ timeout: 10000 });
    await expect(pageB.getByText(/\(2\s*\/\s*8\)/)).toBeVisible({ timeout: 10000 });

    // A (host) starts the game.
    await pageA.getByRole('button', { name: /Start battle/i }).click();

    // Both routes from LobbyClient to BattleGame on status='playing' broadcast.
    await Promise.all([
      pageA.getByRole('grid', { name: 'Sudoku board' }).waitFor({ timeout: 15000 }),
      pageB.getByRole('grid', { name: 'Sudoku board' }).waitFor({ timeout: 15000 }),
    ]);
    // Wait for the 5-second countdown overlay to clear.
    await pageA.waitForTimeout(6000);

    // Convergence: both contexts should see the SAME puzzle. We use the
    // count of given cells as a cheap fingerprint — same puzzle ⇒ same givens
    // ⇒ same count of `, given` aria-labels.
    const givenCountA = await pageA
      .locator('[role="gridcell"][aria-label*=", given"]')
      .count();
    const givenCountB = await pageB
      .locator('[role="gridcell"][aria-label*=", given"]')
      .count();
    expect(givenCountA).toBeGreaterThan(0);
    expect(givenCountA).toBe(givenCountB);

    // Both see the OpponentProgress strip with the opponent's username chip.
    // This is the load-bearing Realtime check: B's room_players subscription
    // delivered A's row, and vice versa.
    await expect(pageA.locator('li').filter({ hasText: '%' })).toHaveCount(2, {
      timeout: 10000,
    });
    await expect(pageB.locator('li').filter({ hasText: '%' })).toHaveCount(2, {
      timeout: 10000,
    });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
