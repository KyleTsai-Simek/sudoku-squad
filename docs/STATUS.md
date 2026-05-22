# Status

**Last updated:** 2026-05-22
**Current phase:** Phase 2 in progress. Lobby + room create/join landed; game start, move sync, and winner detection are next.
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
- **`supabase/migrations/`** — `0001_initial.sql` → `0007_realtime_publications.sql`, all applied to the live project via `supabase db push --linked`. Schema documented in [ARCHITECTURE.md §4](ARCHITECTURE.md).
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

### Phase 2 — Battle mode 🔄 (in progress)

What's landed:
- **Edge Functions** in `supabase/functions/` (deployed to the linked project, `--use-api` bundling):
  - `_shared/cors.ts`, `_shared/errors.ts`, `_shared/supabase.ts` (service-role + caller clients, `getCallerUserId`), `_shared/room-code.ts` (random 6-char base36 + color palette helpers).
  - `create-room({mode, difficulty, username})` — picks a random puzzle via `pick_random_puzzle_code` RPC, generates a unique room code (retry on conflict), inserts the room + host as the first `room_players` row.
  - `join-room({code, username})` — looks up the room, enforces mid-game-join policy ([#0024](DECISIONS.md)), assigns a color from the unused-slots palette, inserts the row. Rejoin (same `auth.uid()`) is idempotent.
- **SQL helpers / RLS fixes:**
  - `pick_random_puzzle_code(difficulty)` — SECURITY DEFINER RPC. Returns just the code; no solution leak.
  - `is_room_member(room_id)` — SECURITY DEFINER helper used by `room_players` and `moves` RLS policies. Fixes the self-referential recursion bug in 0001.
- **Realtime publication** — `room_players`, `moves`, `rooms` added to `supabase_realtime` so the lobby (and gameplay) can subscribe to `postgres_changes`.
- **Web app:**
  - Home page now has three sections: Solo / Battle a friend / Have a code? Battle tier buttons call `create-room` and navigate to `/r/[code]`. Code input calls `join-room` and navigates on success.
  - `apps/web/lib/supabase.ts` — `getSupabase()` (read-only) and `ensureAuthClient()` (signs in anonymously, persists the session in localStorage so refreshes keep the same player).
  - `apps/web/lib/rooms.ts` — `createRoom`, `joinRoom`, `fetchRoomPlayers`, `subscribeToRoomPlayers`. Result-type error shape (`{ ok, value | error }`).
  - `apps/web/lib/username.ts` — localStorage-backed username with random `adj-noun-NN` default for first-time visitors.
  - `apps/web/app/r/[code]/page.tsx` + `lobby-client.tsx` — joins on mount, fetches initial player list, subscribes to changes. Renames stay client-side for now (no UPDATE Edge Function yet). Errors render a dedicated "this room is full / over / not found" screen.

What does NOT yet exist (Phase 2 remainder):
- **Edge Function `submit_move`** — validates a move, assigns `seq`, inserts into `moves`, broadcasts.
- **Edge Function `check_completion`** — server-side win check, returns win/not-yet without leaking which cells are wrong.
- **Edge Function `hint`** — per-cell reveal for the multiplayer hint path (so SP's `sp_get_puzzle` isn't reachable from battle/coop).
- **`packages/core/src/sync/`** — `useRoom(roomCode)` hook, optimistic apply + reconciliation.
- **Battle gameplay UI** — own board + opponent progress bars + winner overlay.
- **Host "Start" button wiring** — currently a disabled stub in the lobby.
- **Mid-game join "already started" screen** — error state exists; copy is generic; can be polished.

### Beyond Phase 2

- **Coop mode / iOS** — Phases 3–4.
- **Auto-eliminate notes** — Setting exposed in the sheet but disabled (placeholder for V2).
- **Favicon / Open Graph metadata** — placeholder Next.js favicon; no OG image yet.
- **Lighthouse / PWA-installable manifest.**
- **Mobile audit** — uses clamp-based font sizing; needs in-device test on 375 px (iPhone SE) and ~420 px.
- **Custom domain** (target: `sudokusquad.com`).
- **`next lint` → ESLint CLI migration** — `apps/web` still uses the deprecated wrapper. Build is currently green but Next.js 16 will remove the wrapper.

---

## Architectural primitives in play (for Phase 2)

- **Puzzle codes** are the cross-mode puzzle reference. `puzzles.code` is the URL slug, the FK from `rooms.puzzle_code`, the `BoardState.puzzleCode` field, and the in-repo sample pack's pinning value. See [DECISIONS.md #0019 / #0020](DECISIONS.md).
- **Room codes** are 6-char lowercase base36, random, retried on collision. Separate namespace from puzzle codes (`/r/[code]` vs `/play/[code]`). See [#0021](DECISIONS.md).
- **`rooms.mode`** restricted to `battle` / `coop` (migration 0004 dropped `single`). Single-player doesn't use rooms.
- **Solution exposure** — `sp_get_puzzle` is single-player only. Multiplayer Edge Functions never return `solution`. See [#0022](DECISIONS.md).
- **Server is authoritative** — all multiplayer mutations go through Edge Functions using the service-role key (per [#0023](DECISIONS.md)). RLS is the second line of defense; the function is the policy.
- **Disconnect grace** = 2 minutes ([#0025](DECISIONS.md)). Battle locks at Start; coop is open anytime ([#0024](DECISIONS.md)).

---

## Gotchas worth knowing before you start

1. **Internal imports are extensionless.** `import './foo'` not `'./foo.js'`. See [CLAUDE.md](../CLAUDE.md) §2 and [DECISIONS.md #0015](DECISIONS.md).
2. **pnpm 11 default-deny on build scripts.** `esbuild`, `sharp`, `unrs-resolver` are allow-listed in `pnpm-workspace.yaml`. See [DECISIONS.md #0016](DECISIONS.md).
3. **Tailwind class precedence in the sudoku board.** Conditional `bg-*` and `text-*` classes can be shadowed by unconditional defaults. The board picks exactly one of each via a small lookup. Extend the lookup rather than appending conditional classes.
4. **Next.js's `.env.local` lives next to the app, not in the monorepo root.** Symlink `apps/web/.env.local → ../../.env.local`. The symlink is gitignored; recreate it on a fresh clone. Without it, `NEXT_PUBLIC_SUPABASE_*` won't reach the client and the home page falls back to the 5 bundled samples.
5. **`puzzles.solution` exposure rule.** Multiplayer (Phase 2+) MUST NOT call `sp_get_puzzle`. Multiplayer Edge Functions return one cell's answer at a time. SP can call the RPC freely — same player, no cheating concern.
6. **The `puzzle_code_for` algorithm lives in two places** — PL/pgSQL in migration 0003 and TypeScript in `scripts/ingest/src/code.ts`. They must stay byte-identical. `code.test.ts` pins two outputs; `verify-samples.ts` re-checks the bundled pack on every run.
7. **RLS policies on `room_players` / `moves` must NOT self-reference.** Migration 0001 had `room_players_read_member` query `room_players` itself in an EXISTS subquery, which Postgres flags as `42P17: infinite recursion`. Migration 0006 added a SECURITY DEFINER `is_room_member(room_id)` helper and the policies use that. If you add a new policy that needs a "member of this room?" check, call `is_room_member(uuid)` — don't write the EXISTS by hand.
8. **Realtime needs explicit publication membership.** A `postgres_changes` subscription on a table silently no-ops if the table isn't in the `supabase_realtime` publication. Migration 0007 added `room_players`, `moves`, `rooms`. If you add a new table that the client needs to subscribe to, `alter publication supabase_realtime add table public.foo;`.

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
