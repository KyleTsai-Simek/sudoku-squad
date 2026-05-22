# Status

**Last updated:** 2026-05-22
**Current phase:** Phase 1 complete; Phase 2 (battle mode) is the next active phase.
**Branch:** `main`
**Live:** https://sudoku-squad-web.vercel.app/

This doc captures *where we actually are*. Update it whenever a phase milestone lands or the focus shifts. If you're a new agent or contributor picking this up cold, this is the single best starting place.

---

## What's built

### Phase 0 — Setup ✅

Monorepo (pnpm 11 workspaces), repo bootstrap, doc set, Supabase project provisioned, GitHub repo, Vercel project. Done.

### Phase 1 — Single-player web ✅

- **`packages/core`** — platform-agnostic TypeScript engine. **36 / 36 tests passing** (unit + property-based with `fast-check`).
  - `types/index.ts` — domain types including `Puzzle`, `BoardState`, `Move`, `PuzzleCode` (cross-mode identifier).
  - `puzzle/board.ts` — `createBoard(puzzleCode, givens)`, `isFilled`, `cellValue`.
  - `puzzle/validator.ts` — `findConflicts` (no solution leak), `isCompleteWithSolution` (server-side use), `unitsFor`.
  - `game/notes.ts` — bitmask helpers.
  - `game/reducer.ts` — `applyMove` pure reducer + `applyMoves` replay helper.
  - `game/history.ts` — undo/redo wrapper.
- **`scripts/ingest`** — Node-only ingest. **9 / 9 tests passing**.
  - `solver.ts` — Norvig solver.
  - `code.ts` — TypeScript port of the Postgres `puzzle_code_for` function. Algorithm pinned by tests.
  - `csv.ts` — streaming CSV reader.
  - `index.ts` — bucketed sampler + Supabase insert.
  - `check-connectivity.ts` — 4 RLS sanity checks against the live project.
  - `verify-samples.ts` — verifies the bundled sample pack against the solver and the code algorithm.
- **`supabase/migrations/`** — `0001_initial.sql` → `0004_rooms_puzzle_code_fk.sql`, all applied to the live project via `supabase db push --linked`. Schema documented in [ARCHITECTURE.md §4](ARCHITECTURE.md).
- **Live puzzle data:** 7 500 rows in the `puzzles` table, sourced from `radcliffe/3-million-sudoku-puzzles-with-ratings` on Kaggle. 2 500 each in easy / medium / hard. Expert tier is 0 by design ([DECISIONS #0018](DECISIONS.md)).
- **`apps/web`** — Next.js 15 + React 19 + Tailwind 3.
  - Routes: `/` (home with per-tier "New game" CTAs) and `/play/[code]` (game screen).
  - Components: `SudokuBoard`, `NumberPad`, `KeyboardController`, `Timer`, `SettingsSheet`, `CompletionOverlay`.
  - State: Zustand store (`lib/game-store.ts`). Solved codes persisted in `localStorage` under `sudokusquad:solved` via `lib/solved-tracker.ts`.
  - Puzzle loading: `lib/puzzle-source.ts` → `loadPuzzle(code)` first checks the bundled pack (`lib/sample-puzzles.ts`, used by the smoke test) then calls the Supabase RPC `sp_get_puzzle`. `listPuzzles()` pages through `puzzles_public`.
  - Picker: `lib/pick-puzzle.ts` → `pickRandomUnsolved(tier)` and `getTierCounts()`.
- **Tooling:**
  - ESLint flat config in `packages/core` blocks Next/RN/DOM/ingest imports and DOM globals.
  - Playwright smoke (`apps/web/e2e/single-player.spec.ts`) — navigates to `/play/3santv`, mashes Hint until the completion overlay appears.
  - GitHub Actions CI runs lint + typecheck + tests + sample/dry-run + web build + Playwright smoke on every PR and push to `main`. Latest run on `main` green.
- **Deploy:**
  - Vercel live at https://sudoku-squad-web.vercel.app/, auto-deploys from `main`. Env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) configured for Production / Preview / Development. Root directory `apps/web`.
  - Supabase CLI linked locally; future migrations push via `supabase db push --linked`.

### Verified working end-to-end

| Check | Command | Status |
|---|---|---|
| Core engine tests | `pnpm --filter @sudoku-squad/core test` | 36 / 36 |
| Ingest tests (solver + code) | `pnpm --filter @sudoku-squad/ingest test` | 9 / 9 |
| Sample-pack verification | `pnpm --filter @sudoku-squad/ingest verify:samples` | 5 / 5 |
| Ingest dry-run on synthetic fixture | `pnpm --filter @sudoku-squad/ingest ingest:dry-fixture` | sampled 5, rejected 2 (as designed) |
| Supabase connectivity + RLS | `pnpm --filter @sudoku-squad/ingest check` | 4 / 4 |
| Core lint (purity rules) | `pnpm --filter @sudoku-squad/core lint` | clean |
| Web lint | `pnpm --filter @sudoku-squad/web lint` | clean |
| Web typecheck | `pnpm --filter @sudoku-squad/web typecheck` | clean |
| Web production build | `pnpm --filter @sudoku-squad/web build` | clean |
| Playwright smoke | `pnpm --filter @sudoku-squad/web test:e2e` | 1 / 1, ~5 s |
| Vercel prod | `curl https://sudoku-squad-web.vercel.app/` | 200, Supabase URL inlined |
| GitHub Actions on `main` | https://github.com/KyleTsai-Simek/sudoku-squad/actions | green |

---

## What does NOT yet exist

- **Edge Functions / realtime sync / multiplayer rooms / coop / iOS** — Phases 2–4.
- **Auto-eliminate notes** — Setting exposed in the sheet but disabled (placeholder for V2).
- **Favicon / Open Graph metadata** — placeholder Next.js favicon; no OG image yet.
- **Lighthouse / PWA-installable manifest.**
- **Mobile audit** — uses clamp-based font sizing; needs in-device test on 375 px (iPhone SE) and ~420 px.
- **Custom domain** (target: `sudokusquad.com`).
- **`next lint` → ESLint CLI migration** — `apps/web` still uses the deprecated wrapper. Build is currently green but Next.js 16 will remove the wrapper.

---

## Phase 2 readiness

Before Phase 2 starts, the project plan is aligned:

- **Puzzle codes are the cross-mode primitive.** `puzzles.code` is the URL slug, the FK from `rooms.puzzle_code`, the `BoardState.puzzleCode` field, and the in-repo sample pack's pinning value. See [DECISIONS.md #0019 / #0020](DECISIONS.md).
- **Room codes** are 6-char lowercase base36, randomly generated, separate namespace from puzzle codes. See [#0021](DECISIONS.md).
- **`rooms.mode`** restricted to `battle` / `coop` (migration 0004 dropped `single`). Single-player doesn't use rooms.
- **`sp_get_puzzle` is single-player-only.** Multiplayer must use Edge Functions that don't expose `solution`. See [#0022](DECISIONS.md).
- **Open questions** that need a decision *before* Phase 2 ships are tracked in [DECISIONS.md → Open questions](DECISIONS.md). They are: Edge Function vs SQL RPC for `submit_move`; mid-game join behavior; profanity filter (deferrable).

---

## Gotchas worth knowing before you start

1. **Internal imports are extensionless.** `import './foo'` not `'./foo.js'`. See [CLAUDE.md](../CLAUDE.md) §2 and [DECISIONS.md #0015](DECISIONS.md).
2. **pnpm 11 default-deny on build scripts.** `esbuild`, `sharp`, `unrs-resolver` are allow-listed in `pnpm-workspace.yaml`. See [DECISIONS.md #0016](DECISIONS.md).
3. **Tailwind class precedence in the sudoku board.** Conditional `bg-*` and `text-*` classes can be shadowed by unconditional defaults. The board picks exactly one of each via a small lookup. Extend the lookup rather than appending conditional classes.
4. **Next.js's `.env.local` lives next to the app, not in the monorepo root.** Symlink `apps/web/.env.local → ../../.env.local`. The symlink is gitignored; recreate it on a fresh clone. Without it, `NEXT_PUBLIC_SUPABASE_*` won't reach the client and the home page falls back to the 5 bundled samples.
5. **`puzzles.solution` exposure rule.** Multiplayer (Phase 2+) MUST NOT call `sp_get_puzzle`. Multiplayer Edge Functions return one cell's answer at a time. SP can call the RPC freely — same player, no cheating concern.
6. **The `puzzle_code_for` algorithm lives in two places** — PL/pgSQL in migration 0003 and TypeScript in `scripts/ingest/src/code.ts`. They must stay byte-identical. `code.test.ts` pins two outputs; `verify-samples.ts` re-checks the bundled pack on every run.

---

## How to verify the environment is healthy

```bash
cd /Users/kylets/sudoku-squad
pnpm install                                              # idempotent
pnpm --filter @sudoku-squad/core test                     # expect 36/36
pnpm --filter @sudoku-squad/ingest test                   # expect 9/9
pnpm --filter @sudoku-squad/ingest verify:samples         # expect 5 OK
pnpm --filter @sudoku-squad/ingest check                  # expect 4/4
pnpm -r typecheck                                         # expect clean
pnpm --filter @sudoku-squad/web build                     # expect clean
pnpm --filter @sudoku-squad/web test:e2e                  # expect 1/1
pnpm dev                                                  # http://localhost:3000
```

If any step fails, fix before adding features.
