import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for apps/web.
 *
 * The dev server is started by Playwright (`webServer`) and torn down at the
 * end. We use port 3100 so smoke runs don't fight a developer's running
 * `pnpm dev` on 3000/3001.
 */
const PORT = Number(process.env.PORT ?? 3100);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Locally the live multiplayer smokes (battle + coop) each spin up two
  // browser contexts and lean hard on Supabase Realtime; running them
  // concurrently overloads the dev server / Realtime and they flake on lobby
  // sync. Run serially off-CI. In CI those specs self-skip (no Supabase env),
  // so only the fast single-player specs run — leave them parallel there.
  workers: process.env.CI ? undefined : 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 60_000,
  },
});
