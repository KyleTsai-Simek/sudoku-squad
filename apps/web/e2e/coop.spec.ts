import { expect, test } from '@playwright/test';

/**
 * Two-context co-op smoke. Drives a shared-board co-op game through two
 * separate Playwright contexts and verifies the load-bearing sync paths:
 * room creation, join, lobby sync, start, shared-board convergence via the
 * `moves` realtime channel, and — the focus of this spec — that an undo
 * faithfully restores auto-cleared peer notes on the *other* client.
 *
 * The notes case is the regression guard for DECISIONS #0041: placing a value
 * auto-clears that digit from peer cells' notes; undoing it must bring those
 * notes back everywhere, not just on the undoing client. The pre-#0041 code
 * emitted a lone `clear` as the compensating move, so a peer's note never
 * reappeared in the server log and the second client stayed diverged. With the
 * `movesToReach` batch the restore rides along as a real `note_toggle`.
 *
 * **Requires live Supabase env** (NEXT_PUBLIC_SUPABASE_URL + ANON_KEY in
 * .env.local, picked up by the dev server via the symlink). Skipped in CI for
 * the same reason as battle.spec.ts — the GitHub Actions job has no Supabase
 * env, so `createRoom` can't reach the Edge Function. The core property test
 * (`packages/core/src/game/board-diff.test.ts`) gates the diff math in CI.
 */
test.skip(!!process.env.CI, 'coop smoke requires live Supabase — skipping in CI');

// Cross-context Realtime propagation on a cold local dev server can take
// 10-15s per move (much faster in prod), and this spec waits on several
// round-trips, so give it a generous overall budget.
test.setTimeout(120_000);

const SYNC = 20_000; // per cross-client wait
const ROOM_CODE_RE = /\/r\/([a-z0-9]{6})/;

/** Find a board row that has at least two empty (non-given) cells, so we have
 *  a peer pair to exercise the note auto-clear/undo. Returns 1-based row +
 *  the first two 1-based columns. */
async function findPeerPair(
  page: import('@playwright/test').Page,
): Promise<{ row: number; cols: [number, number] }> {
  const found = await page.evaluate(() => {
    const byRow: Record<number, number[]> = {};
    for (const el of Array.from(document.querySelectorAll('[role="gridcell"]'))) {
      const m = (el.getAttribute('aria-label') || '').match(/^row (\d+), column (\d+), empty$/);
      if (m) {
        const r = Number(m[1]);
        (byRow[r] ||= []).push(Number(m[2]));
      }
    }
    for (const key of Object.keys(byRow)) {
      const r = Number(key);
      if (byRow[r]!.length >= 2) return { row: r, cols: [byRow[r]![0]!, byRow[r]![1]!] };
    }
    return null;
  });
  if (!found) throw new Error('no row with two empty cells found');
  return found as { row: number; cols: [number, number] };
}

test('coop: shared board syncs + undo restores auto-cleared peer notes', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    // A creates a co-op room.
    await pageA.goto('/');
    await expect(pageA.getByRole('heading', { name: 'Sudoku Squad' })).toBeVisible();
    await pageA.getByRole('button', { name: /Co-op/ }).click();
    await pageA.waitForURL(ROOM_CODE_RE, { timeout: 15000 });
    const code = pageA.url().match(ROOM_CODE_RE)![1]!;

    // B joins via the shared room URL.
    await pageB.goto(`/r/${code}`);
    await pageB.waitForURL(new RegExp(`/r/${code}`), { timeout: 15000 });

    // Lobby sync: both see (2/8) via Realtime.
    await expect(pageA.getByText(/\(2\s*\/\s*8\)/)).toBeVisible({ timeout: 10000 });
    await expect(pageB.getByText(/\(2\s*\/\s*8\)/)).toBeVisible({ timeout: 10000 });

    // A (host) starts co-op. Both route from LobbyClient to CoopGame.
    await pageA.getByRole('button', { name: 'Start co-op', exact: true }).click();
    await Promise.all([
      pageA.getByRole('grid', { name: 'Sudoku board' }).waitFor({ timeout: 15000 }),
      pageB.getByRole('grid', { name: 'Sudoku board' }).waitFor({ timeout: 15000 }),
    ]);
    // Wait out the 5-second start countdown before input is accepted.
    await pageA.waitForTimeout(6000);

    // Pick a peer pair: P (gets a note) and C (gets the value that auto-clears
    // P's note). Same row ⇒ peers.
    const { row, cols } = await findPeerPair(pageA);
    const [pCol, cCol] = cols;
    const DIGIT = 5;

    const cellP = (page: typeof pageA) =>
      page.getByRole('gridcell', { name: new RegExp(`^row ${row}, column ${pCol}, empty$`) });
    const cellC = (page: typeof pageA) =>
      page.getByRole('gridcell', { name: new RegExp(`^row ${row}, column ${cCol}, empty$`) });
    // A note digit lives as plain text inside an otherwise-empty cell.
    const noteInP = (page: typeof pageA) => cellP(page).getByText(String(DIGIT), { exact: true });

    // Step 1: A pencils note 5 into P (notes mode on → enter → notes mode off).
    await pageA.getByRole('button', { name: /Turn notes mode on/ }).click();
    await cellP(pageA).click();
    await pageA.getByRole('button', { name: `Enter ${DIGIT}`, exact: true }).click();
    await pageA.getByRole('button', { name: /Turn notes mode off/ }).click();
    await expect(noteInP(pageA)).toBeVisible({ timeout: 5000 });

    // Step 2: A places value 5 in peer cell C → auto-clears note 5 from P.
    await cellC(pageA).click();
    await pageA.getByRole('button', { name: `Enter ${DIGIT}`, exact: true }).click();
    await expect(
      pageA.getByRole('gridcell', { name: new RegExp(`^row ${row}, column ${cCol}, value ${DIGIT}`) }),
    ).toBeVisible({ timeout: 5000 });
    await expect(noteInP(pageA)).toHaveCount(0, { timeout: 5000 });

    // Step 3: A undoes the value placement. Locally C empties and P's note 5
    // returns.
    await pageA.getByRole('button', { name: 'Undo' }).click();
    await expect(noteInP(pageA)).toBeVisible({ timeout: 5000 });
    await expect(
      pageA.getByRole('gridcell', { name: new RegExp(`^row ${row}, column ${cCol}, empty$`) }),
    ).toBeVisible({ timeout: 5000 });

    // Let A's compensating batch (clear C + note_toggle P) persist server-side.
    await pageA.waitForTimeout(4000);

    // The regression guard for #0041: B re-materializes the WHOLE move log from
    // the server (reload → fetchAllMoves → replay). If the undo had emitted a
    // lone `clear` (the pre-#0041 behavior), the log would never have restored
    // P's auto-cleared note and B's replay would show P empty. With the faithful
    // movesToReach batch, the restore rides along as a real note_toggle, so B's
    // independent replay shows note 5 back in P and C empty. Reload sidesteps
    // realtime tail-delivery timing — it tests the log itself.
    await pageB.reload();
    await pageB.getByRole('grid', { name: 'Sudoku board' }).waitFor({ timeout: SYNC });
    await expect(noteInP(pageB)).toBeVisible({ timeout: SYNC });
    await expect(
      pageB.getByRole('gridcell', { name: new RegExp(`^row ${row}, column ${cCol}, empty$`) }),
    ).toBeVisible({ timeout: SYNC });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
