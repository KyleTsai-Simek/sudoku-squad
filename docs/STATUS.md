# Status

**Last updated:** 2026-05-21
**Current phase:** end of Phase 0 (setup) → start of Phase 1 (single-player web)
**Branch:** `main`

This doc captures *where we actually are*. Update it whenever a phase milestone lands or the current focus shifts. If you're a new agent or contributor picking this up cold, this is the single best starting place.

---

## What's built and verified

### Scaffolding (Phase 0 — complete)

- **Monorepo** via pnpm 11 workspaces (`apps/*`, `packages/*`, `scripts/*`).
- **`packages/core`** — TypeScript-only, platform-agnostic. Currently contains:
  - `types/` — full domain type system (`BoardState`, `Cell`, `Move`, `Puzzle`, `PersistedMove`, ID brands, etc.)
  - `puzzle/board.ts` — `createBoard`, `isFilled`, `cellValue` helpers
  - `puzzle/validator.ts` — `findConflicts` (row/col/box rule violations, does NOT use solution), `isCompleteWithSolution` (server-side use only), `unitsFor`
  - `game/` and `sync/` — empty placeholder modules awaiting Phase 1 + Phase 2 work
  - 6 Vitest unit tests, all passing
- **`scripts/ingest`** — Node ESM scripts package, never shipped to clients.
  - `solver.ts` — full Norvig-style constraint-propagation solver (~150 LoC). Exports `solve`, `countSolutions`, `hasUniqueSolution`.
  - `check-connectivity.ts` — sanity check against the live Supabase project (URL + RLS).
  - `index.ts` — placeholder for the dataset ingest run (Kaggle CSV reader not yet written).
  - 4 Vitest tests, all passing (including the world's hardest sudoku).
- **`apps/web`** — Next.js 15 (App Router) + React 19 + Tailwind 3 + TypeScript. Home page renders, consumes `@sudoku-squad/core` via workspace dep, verified at runtime.
- **`supabase/migrations/0001_initial.sql`** — applied to the live Supabase project. Creates `puzzles`, `rooms`, `room_players`, `moves`, the `puzzles_public` view (no `solution` column), and a first cut of RLS policies.
- **Deployment scaffolding:**
  - Supabase project: `enaavxfrjlqqslziyypq.supabase.co` (US East). Anonymous auth enabled.
  - GitHub: [`KyleTsai-Simek/sudoku-squad`](https://github.com/KyleTsai-Simek/sudoku-squad) — `main` pushed.
  - Vercel: account exists; project not yet connected.
  - Domain: not yet registered. Target: `sudokusquad.com`.
  - Apple Developer: not yet started (Phase 4 only — start ~1 week before Phase 4 begins because approval takes that long).
- **Local env:** `.env.local` at repo root contains `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Gitignored.

### Verified working end-to-end

| Check | Command | Status |
|---|---|---|
| Core engine tests | `pnpm --filter @sudoku-squad/core test` | 6/6 passing |
| Solver tests (incl. world-hardest) | `pnpm --filter @sudoku-squad/ingest test` | 4/4 passing |
| Supabase connectivity + RLS | `pnpm --filter @sudoku-squad/ingest check` | 3/3 (1 yellow note — expected for empty table; see Gotchas) |
| Next.js dev server | `pnpm dev` → http://localhost:3000 | renders cleanly |
| Workspace import at runtime | home page imports `createBoard` from `@sudoku-squad/core` | ✓ |

---

## What does NOT yet exist

Important to be explicit about, so nothing is assumed:

- **Move reducer** (`packages/core/src/game/`) — only an empty `index.ts`. This is the first Phase 1 task.
- **Property-based tests** — `fast-check` is installed but no property tests written yet. Add as part of Phase 1.
- **Sudoku grid UI** — `apps/web` only has a placeholder home page.
- **Real puzzles in the database** — `puzzles` table is empty. The Kaggle CSV ingest is a placeholder (`scripts/ingest/src/index.ts`).
- **Supabase Edge Functions** — none yet. Phase 2 work.
- **Realtime sync layer** — `packages/core/src/sync/` is empty. Phase 2.
- **Coop / battle modes** — Phase 2 and Phase 3.
- **iOS app** — Phase 4.
- **ESLint rules** for `packages/core` purity (no DOM, no Next, no RN, no solver imports) — planned but not yet configured.
- **CI** (GitHub Actions) — not yet set up. Add when convenient (before Phase 2 ideally).
- **Playwright config** — `@playwright/test` is installed but no test files or config exist yet.
- **Domain, public deploy, Apple Developer account** — see "Deployment scaffolding" above.

---

## Gotchas worth knowing before you start

These all came up during setup and the fixes are now in the repo. Listed so they're not relearned the hard way.

1. **Internal imports are extensionless.** Inside `packages/core` and `scripts/ingest`, use `import ... from './foo'`, not `from './foo.js'`. Next.js's bundler doesn't resolve `.js` imports to `.ts` source files in workspace packages. Documented in [CLAUDE.md](../CLAUDE.md) §2 and [DECISIONS.md #0015](DECISIONS.md).
2. **pnpm 11 default-deny on build scripts.** Native-binary packages (`esbuild`, `sharp`, `unrs-resolver`) need explicit allow-listing in `pnpm-workspace.yaml` under `allowBuilds:`. Already configured. Documented in [DECISIONS.md #0016](DECISIONS.md).
3. **The connectivity check shows a yellow note when `puzzles` is empty.** That's expected — when the table has zero rows *and* RLS denies anon access, both produce "no rows," so the script can't programmatically distinguish them. After ingest lands and the table has real data, the same check becomes a definitive security test. The script comment explains this.
4. **Next.js 15 promoted `typedRoutes` out of `experimental`.** `next.config.ts` reflects this. Don't reintroduce `experimental.typedRoutes`.
5. **`puzzles.solution` must never reach the client.** Always read from `puzzles_public` for anon. Read from `puzzles` only via service-role clients (Edge Functions, ingest scripts). RLS enforces this but lint discipline matters too.

---

## What to start next (Phase 1, ordered)

The roadmap says single-player web. Detailed in [TODO.md](TODO.md). Suggested order:

1. **Move reducer in `packages/core/src/game/`** — `applyMove(state, move) -> state`. Pure function. Unit tests for each move kind (`value`, `clear`, `note_toggle`) including guarding against writes to given cells. **Then property-based tests** with `fast-check` asserting invariants: no cell ever has an invalid value; replaying a move log produces the same state as applying moves one-by-one.
2. **Kaggle dataset ingest in `scripts/ingest/src/index.ts`** — download the Kaggle CSV to `scripts/ingest/data/`, parse rows, verify uniqueness with the solver, sample 500–1000 medium puzzles, upsert via service-role Supabase client. After this, the `puzzles` table has real data and the connectivity check can be tightened.
3. **Sudoku grid UI in `apps/web`** — 9×9 grid component, selection state, row/col/box highlighting, number pad with notes toggle, keyboard input (1–9, arrows, N for notes mode, Backspace). Mobile-responsive layout.
4. **Settings sheet, timer, completion celebration** — wraps single-player as a finished experience.

Each of these is roughly a session's worth of focused work.

---

## How to verify the environment is still healthy

If you sit down to work on this project and want to confirm nothing has rotted:

```bash
cd /Users/kylets/sudoku-squad   # or wherever the repo lives
pnpm install                     # idempotent; should be a no-op if up to date
pnpm --filter @sudoku-squad/core test
pnpm --filter @sudoku-squad/ingest test
pnpm --filter @sudoku-squad/ingest check
pnpm dev
# Open http://localhost:3000 — home page should render
```

If any of those fail, fix before adding new features.
