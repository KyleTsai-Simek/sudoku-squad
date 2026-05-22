# Status

**Last updated:** 2026-05-21
**Current phase:** Phase 1 (single-player web) — most of the vertical slice is playable; Kaggle ingest + CI/deploy remain.
**Branch:** `main`

This doc captures *where we actually are*. Update it whenever a phase milestone lands or the current focus shifts. If you're a new agent or contributor picking this up cold, this is the single best starting place.

---

## What's built and verified

### Scaffolding (Phase 0 — complete)

- **Monorepo** via pnpm 11 workspaces (`apps/*`, `packages/*`, `scripts/*`).
- **`packages/core`** — TypeScript-only, platform-agnostic.
  - `types/` — full domain type system (`BoardState`, `Cell`, `Move`, `Puzzle`, `PersistedMove`, ID brands, etc.)
  - `puzzle/board.ts` — `createBoard`, `isFilled`, `cellValue` helpers
  - `puzzle/validator.ts` — `findConflicts` (rule violations, no solution leak), `isCompleteWithSolution` (server-side use), `unitsFor`
  - **`game/notes.ts`** — bitmask helpers: `setNote`, `clearNote`, `toggleNote`, `hasNote`, `notesToArray`, `clearAllNotes`.
  - **`game/reducer.ts`** — `applyMove(state, move) -> state` pure reducer + `applyMoves` (replay helper). Refuses writes to given cells, returns same reference for no-ops.
  - **`game/history.ts`** — `applyMoveWithHistory`, `undo`, `redo`, `canUndo`, `canRedo`. Local-only — never sent to server.
  - **36/36 tests passing** (Vitest): unit + property-based (`fast-check`) for the reducer, notes, history, and board helpers. Property tests assert: no cell ever holds invalid value, replay == fold, given cells never modified, clear leaves both value+notes empty, validator never flags an empty cell.
- **`scripts/ingest`** — Node ESM, never shipped to clients.
  - `solver.ts` — Norvig solver. `solve`, `countSolutions`, `hasUniqueSolution`.
  - `check-connectivity.ts` — Supabase URL + RLS sanity check.
  - **`verify-samples.ts`** — verifies the web app's sample puzzle pack against the solver; runs via `pnpm --filter @sudoku-squad/ingest verify:samples`. All 5 currently pass.
  - 4/4 solver tests passing (incl. world-hardest).
- **`apps/web`** — Next.js 15 + React 19 + Tailwind 3. **Single-player vertical slice complete:**
  - `/` — landing page with **New Game** CTA + Quick Start grid (5 sample puzzles) + Battle/Coop placeholders.
  - `/play?seed=...` — full game screen.
  - Components: `SudokuBoard`, `NumberPad`, `KeyboardController`, `Timer`, `SettingsSheet`, `CompletionOverlay`.
  - Game state lives in a Zustand store (`lib/game-store.ts`).
  - Sample puzzle pack lives in `lib/sample-puzzles.ts` (5 puzzles, solver-verified). Replace with Supabase fetch once ingest lands. See [DECISIONS.md #0017](DECISIONS.md).
  - Interaction verified in-browser (Claude Preview): cell selection, row/col/box + same-value highlights, conflict highlighting (rule-based, no solution leak), notes mode (UI wired), keyboard input, undo/redo, hint (reveals correct value from solution; locally OK in single-player), timer, settings, completion overlay with elapsed time + hint count.
  - Build green (`pnpm --filter @sudoku-squad/web build`), zero console errors at runtime.
- **`supabase/migrations/0001_initial.sql`** — applied. `puzzles`, `rooms`, `room_players`, `moves`, `puzzles_public` view, first cut of RLS policies.
- **Deployment scaffolding:** Supabase project `enaavxfrjlqqslziyypq.supabase.co`. GitHub `KyleTsai-Simek/sudoku-squad`. Vercel not yet wired. Domain not registered.

### Verified working end-to-end

| Check | Command | Status |
|---|---|---|
| Core engine tests | `pnpm --filter @sudoku-squad/core test` | 36/36 passing |
| Solver tests | `pnpm --filter @sudoku-squad/ingest test` | 4/4 passing |
| Sample-puzzle verification | `pnpm --filter @sudoku-squad/ingest verify:samples` | 5/5 OK |
| Supabase connectivity + RLS | `pnpm --filter @sudoku-squad/ingest check` | 3/3 (yellow note expected while `puzzles` is empty) |
| Web typecheck | `pnpm --filter @sudoku-squad/web typecheck` | clean |
| Web production build | `pnpm --filter @sudoku-squad/web build` | clean |
| Dev server | `pnpm dev` → `localhost:3000` (or `3001` if taken) | renders, plays through to completion |

---

## What does NOT yet exist

- **Real puzzles in Supabase** — `puzzles` table is empty. The Kaggle CSV ingest is still a placeholder (`scripts/ingest/src/index.ts`). Single-player uses the bundled `lib/sample-puzzles.ts` until ingest lands.
- **Auto-eliminate notes** — Setting exposed in the sheet but disabled (placeholder for V2).
- **ESLint rules** for `packages/core` purity (no DOM, no Next, no RN, no solver imports) — planned but not wired.
- **Playwright** — `@playwright/test` installed, no config or smoke yet.
- **CI** (GitHub Actions) — not set up.
- **Supabase Edge Functions, realtime sync, coop, battle, iOS** — Phases 2–4.
- **Domain, public deploy, Apple Developer account** — see "Deployment scaffolding" above.

---

## Gotchas worth knowing before you start

1. **Internal imports are extensionless.** `import './foo'` not `'./foo.js'`. Documented in [CLAUDE.md](../CLAUDE.md) §2 and [DECISIONS.md #0015](DECISIONS.md).
2. **pnpm 11 default-deny on build scripts.** Native-binary packages (`esbuild`, `sharp`, `unrs-resolver`) are allow-listed in `pnpm-workspace.yaml` under `allowBuilds:`. See [DECISIONS.md #0016](DECISIONS.md).
3. **Tailwind class precedence in the sudoku board.** A handful of cell states (selected/conflict/sameValue/inUnit) all set background and text colors. Tailwind v3 orders classes by stylesheet position, not className order — so combining `bg-white` (unconditional) with `bg-amber-200` (conditional) had `bg-white` winning. The board now picks exactly one `bg-*` class and one `text-*` color via a small lookup. If you add new states, extend that lookup rather than appending a conditional class.
4. **The connectivity check shows a yellow note when `puzzles` is empty.** Expected. Once ingest populates the table, the same check becomes a definitive RLS test.
5. **Next.js 15 promoted `typedRoutes` out of `experimental`.** `next.config.ts` reflects this.
6. **`useSearchParams` requires a Suspense boundary** for static prerendering. `/play` wraps `PlayClient` in `<Suspense>` for this reason; if you add another search-param-using component to a server-rendered page, do the same.
7. **`puzzles.solution` must never reach the client during multiplayer.** Single-player today uses the bundled pack — solutions are intentionally client-side because there's no one to cheat against. When ingest lands and SP starts fetching from Supabase, that flow must use `puzzles_public` (no solution) + server-side hint/win-check, exactly like multiplayer.

---

## What to start next

Phase 1 punch list, ordered:

1. **Kaggle dataset ingest** in `scripts/ingest/src/index.ts` — download CSV, parse, verify uniqueness, sample medium-difficulty rows, upsert to Supabase via service-role client. After this, the connectivity check becomes a stronger RLS test and SP can swap the bundled pack for a Supabase fetch.
2. **ESLint purity rules** for `packages/core` (no DOM/Next/RN, no solver imports).
3. **Playwright config + first happy-path smoke** in `apps/web` (load home → start game → complete via hints → see overlay).
4. **GitHub Actions CI** — lint, typecheck, unit + property tests, build, smoke.
5. **Vercel deploy** wired to `main`.
6. **Phase 2 — Battle mode** begins.

Each of these is roughly a session's worth of focused work.

---

## How to verify the environment is still healthy

```bash
cd /Users/kylets/sudoku-squad
pnpm install                                              # idempotent
pnpm --filter @sudoku-squad/core test                     # expect 36/36
pnpm --filter @sudoku-squad/ingest test                   # expect 4/4
pnpm --filter @sudoku-squad/ingest verify:samples         # expect 5 OK
pnpm --filter @sudoku-squad/web typecheck                 # expect clean
pnpm --filter @sudoku-squad/web build                     # expect clean
pnpm dev                                                  # play through a puzzle
```

If any step fails, fix before adding features.
