import { expect, test } from '@playwright/test';

/**
 * Two-context battle smoke. Drives a battle game through two separate
 * Playwright contexts (each gets its own anon-auth session). Verifies the
 * load-bearing sync paths: room creation, join, lobby sync, start, board
 * convergence, and opponent-progress broadcast.
 *
 * **Requires live Supabase env** (NEXT_PUBLIC_SUPABASE_URL + ANON_KEY in
 * .env.local). The dev server picks these up via the symlink.
 *
 * Skipped in CI for now — Supabase env isn't available to the GitHub
 * Actions job, so `createRoom` can't reach the Edge Function. The SP
 * smoke (which short-circuits to a bundled sample) continues to gate CI.
 * Future work: either add Supabase secrets to CI or stand up a separate
 * CI-only project. Tracked as task #56.
 */

// In CI the dev server can't reach Supabase (no env), so this whole spec
// hangs on `createRoom`. Skip when `process.env.CI` is set — local runs
// with `.env.local` symlinked into apps/web continue to execute it.
// The SP smoke gates CI; this one is local-only until we wire CI env.
test.skip(!!process.env.CI, 'battle smoke requires live Supabase — skipping in CI');

/*
 * Scope intentionally stops short of full race-to-completion + late-finish.
 * Those flows can be added once the underlying submit-move latency is
 * better understood (each call is ~1.5s warm; 50 sequential moves takes
 * 75+ seconds to fully land on the server). The sync primitives this test
 * does exercise — Realtime member subscription, lobby→game routing,
 * `submit-move` progress_pct + `room_players` broadcast — are what Phase 3
 * coop will inherit.
 */

const ROOM_CODE_RE = /\/r\/([a-z0-9]{6})/;

async function createBattleRoom(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sudoku Squad' })).toBeVisible();
  await page.getByRole('button', { name: /Start a game/ }).click();
  await page.getByRole('button', { name: /^Battle/ }).click();
  await page.waitForURL(ROOM_CODE_RE, { timeout: 15000 });
  return page.url().match(ROOM_CODE_RE)![1]!;
}

test('battle: create + join + start + sync', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    const code = await createBattleRoom(pageA);

    // B joins by navigating directly to the room URL (the same path shared-
    // link recipients take). The home page no longer carries a join input;
    // public-lobby browsing is implicit via the list below the cards.
    await pageB.goto(`/r/${code}`);
    await pageB.waitForURL(new RegExp(`/r/${code}`), { timeout: 15000 });

    // Lobby sync: both see the (2/8) player count via Realtime broadcast.
    await expect(pageA.getByText(/\(2\s*\/\s*8\)/)).toBeVisible({ timeout: 10000 });
    await expect(pageB.getByText(/\(2\s*\/\s*8\)/)).toBeVisible({ timeout: 10000 });

    // A (host) starts the game. Two Start controls exist (inline + FAB);
    // target the inline one by its exact label.
    await pageA.getByRole('button', { name: 'Start battle', exact: true }).click();

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

    // Undo/redo progress sync (DECISIONS #0039). A's own progress bar reads
    // `ownProgressPct`, set from the submit-move echo. Filling a cell must
    // raise it, undo must drop it back, redo must restore it — i.e. undo/redo
    // behave like real moves rather than drifting the bar (the old bug).
    const maxOwnPct = async () => {
      const texts = await pageA.locator('li').filter({ hasText: '%' }).allInnerTexts();
      const nums = texts.flatMap((t) =>
        Array.from(t.matchAll(/(\d+)\s*%/g)).map((m) => Number(m[1])),
      );
      return nums.length ? Math.max(...nums) : 0;
    };

    await expect.poll(maxOwnPct, { timeout: 10000 }).toBe(0);
    await pageA.locator('[role="gridcell"]:not([aria-label*="given"])').first().click();
    await pageA.getByRole('button', { name: 'Enter 1' }).click();
    await expect.poll(maxOwnPct, { timeout: 10000 }).toBeGreaterThan(0);

    await pageA.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(maxOwnPct, { timeout: 10000 }).toBe(0);

    await pageA.getByRole('button', { name: 'Redo' }).click();
    await expect.poll(maxOwnPct, { timeout: 10000 }).toBeGreaterThan(0);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

/**
 * Mid-battle reload regression. A battle player's board lives only on the
 * server (private per-player log); a page reload must re-materialize it from
 * `fetchOwnMoves` rather than showing an empty grid. Before the fix,
 * `startBattle` built a fresh board from givens only, so reloading wiped the
 * player's visible progress until their next submit triggered a resync.
 */
test('battle: reload mid-game restores own board + progress', async ({ browser }) => {
  // 5s countdown + several warm ~1.5s submits + a reload comfortably exceeds
  // the 30s default. Give it the headroom the existing smoke implicitly has.
  test.setTimeout(90_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    const code = await createBattleRoom(pageA);

    await pageB.goto(`/r/${code}`);
    await pageB.waitForURL(new RegExp(`/r/${code}`), { timeout: 15000 });
    await expect(pageA.getByText(/\(2\s*\/\s*8\)/)).toBeVisible({ timeout: 10000 });

    await pageA.getByRole('button', { name: 'Start battle', exact: true }).click();
    await pageA.getByRole('grid', { name: 'Sudoku board' }).waitFor({ timeout: 15000 });
    // Wait out the 5s countdown so input is unlocked.
    await pageA.waitForTimeout(6000);

    // Capture two distinct empty cells up front (the puzzle is server-random,
    // so we can't hardcode coordinates). Re-locate by their exact labels.
    const emptyCells = pageA.locator('[role="gridcell"][aria-label*="empty"]');
    const coordsOf = (label: string) => {
      const m = label.match(/row (\d+), column (\d+)/)!;
      return { row: m[1]!, col: m[2]! };
    };
    const c0 = coordsOf((await emptyCells.nth(0).getAttribute('aria-label'))!);
    const c1 = coordsOf((await emptyCells.nth(1).getAttribute('aria-label'))!);

    const cellByCoord = (c: { row: string; col: string }, suffix: string) =>
      pageA.getByRole('gridcell', {
        name: new RegExp(`row ${c.row}, column ${c.col}, ${suffix}`),
      });

    // Fill both cells with distinct values (avoids a same-row/box collision
    // mattering — either way the entered value renders).
    await cellByCoord(c0, 'empty').click();
    await pageA.getByRole('button', { name: 'Enter 1' }).click();
    await expect(cellByCoord(c0, 'value 1')).toBeVisible();
    await cellByCoord(c1, 'empty').click();
    await pageA.getByRole('button', { name: 'Enter 2' }).click();
    await expect(cellByCoord(c1, 'value 2')).toBeVisible();

    // Progress > 0 means both submits committed server-side (the bar reads
    // `ownProgressPct` from the submit-move echo) — i.e. the moves are durable
    // and a reload will be able to fetch them.
    const maxOwnPct = async () => {
      const texts = await pageA.locator('li').filter({ hasText: '%' }).allInnerTexts();
      const nums = texts.flatMap((t) =>
        Array.from(t.matchAll(/(\d+)\s*%/g)).map((m) => Number(m[1])),
      );
      return nums.length ? Math.max(...nums) : 0;
    };
    // Wait for the bar to *settle* (both submits' echoes landed) rather than
    // snapshotting after the first — otherwise pctBefore can capture a
    // mid-update value and the post-reload `toBe` races. Stable = two
    // consecutive reads agree and are non-zero.
    let lastPct = -1;
    await expect
      .poll(
        async () => {
          const v = await maxOwnPct();
          const settled = v > 0 && v === lastPct;
          lastPct = v;
          return settled;
        },
        { timeout: 15000, intervals: [500] },
      )
      .toBe(true);
    const pctBefore = lastPct;

    // Reload mid-battle. Status is 'playing', so page.tsx routes straight to
    // BattleGame, which re-materializes from the server log.
    await pageA.reload();
    // The rejoin handshake (re-auth + room-status resync via Realtime) before
    // LobbyClient routes back to BattleGame can take a beat on a loaded dev
    // server, so allow generous headroom for the grid to reappear.
    await pageA.getByRole('grid', { name: 'Sudoku board' }).waitFor({ timeout: 30000 });

    // Both entered values are still shown (the bug: empty grid here)...
    await expect(cellByCoord(c0, 'value 1')).toBeVisible({ timeout: 10000 });
    await expect(cellByCoord(c1, 'value 2')).toBeVisible({ timeout: 10000 });
    // ...and own progress is restored without needing another submit. The bug
    // reset it to 0 (empty board materialized from givens only); the fix
    // materializes from the own move log, so it comes back >= the pre-reload
    // reading. (Exact equality is avoided: pre-reload the own row reads the
    // laggy room_players broadcast, post-reload it's the freshly materialized
    // board, so the post value can be a touch higher.)
    await expect.poll(maxOwnPct, { timeout: 10000 }).toBeGreaterThanOrEqual(pctBefore);
    expect(pctBefore).toBeGreaterThan(0);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('battle: late joiner enters an already-started game', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const pageC = await ctxC.newPage();

  try {
    const code = await createBattleRoom(pageA);

    await pageB.goto(`/r/${code}`);
    await pageB.waitForURL(new RegExp(`/r/${code}`), { timeout: 15000 });
    await expect(pageA.getByText(/\(2\s*\/\s*8\)/)).toBeVisible({ timeout: 10000 });

    await pageA.getByRole('button', { name: 'Start battle', exact: true }).click();
    await pageA.getByRole('grid', { name: 'Sudoku board' }).waitFor({ timeout: 15000 });
    await pageA.waitForTimeout(6000);

    await pageC.goto(`/r/${code}`);
    await pageC.waitForURL(new RegExp(`/r/${code}`), { timeout: 15000 });
    await pageC.getByRole('grid', { name: 'Sudoku board' }).waitFor({ timeout: 30000 });

    await expect(pageC.locator('li').filter({ hasText: '%' })).toHaveCount(3, {
      timeout: 10000,
    });
    await expect(pageA.locator('li').filter({ hasText: '%' })).toHaveCount(3, {
      timeout: 10000,
    });

    const lateJoinerMaxPct = async () => {
      const texts = await pageC.locator('li').filter({ hasText: '%' }).allInnerTexts();
      const nums = texts.flatMap((t) =>
        Array.from(t.matchAll(/(\d+)\s*%/g)).map((m) => Number(m[1])),
      );
      return nums.length ? Math.max(...nums) : 0;
    };

    await expect.poll(lateJoinerMaxPct, { timeout: 10000 }).toBe(0);
    await pageC.locator('[role="gridcell"]:not([aria-label*="given"])').first().click();
    await pageC.getByRole('button', { name: 'Enter 1' }).click();
    await expect.poll(lateJoinerMaxPct, { timeout: 10000 }).toBeGreaterThan(0);
  } finally {
    await ctxA.close();
    await ctxB.close();
    await ctxC.close();
  }
});
