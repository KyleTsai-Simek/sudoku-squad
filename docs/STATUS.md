# Status

**Last updated:** 2026-05-29 (doc-sync pass: reconciled all docs against the codebase — test counts, migration count, Edge Function inventory, and coop status. Coop MVP is in the tree.)
**Current phase:** Phase 2 (battle) is fully playable end-to-end, and **Phase 3 (coop) has an MVP landed** — a shared board with last-write-wins per cell by seq, optimistic apply + server-overlay reconciliation, and a per-player colored progress bar. The May 22 UX expansion (chunks A–H) plus a UX-polish pass (board pixel-snap, auto-clean peer notes, spacebar notes toggle + `?` shortcuts overlay, Notes button visual rework) all shipped. The May 23 sync rewrite ([#0036](DECISIONS.md): atomic seq counter, idempotency, parallel submits, coop server-overlay store, fail-resync), the batching-and-resync followup ([#0037](DECISIONS.md): per-room opportunistic batching, batch RPC, gap/reconnect/visibility resync), and the coop per-player credit rule ([#0038](DECISIONS.md)) are the latest landings. Remaining: the two-tab Playwright smoke extension to race-to-completion, and coop polish (Presence cursors, private notes). iOS is the next phase.
**Branch:** `main`
**Live:** https://sudoku-squad-web.vercel.app/

This doc captures *where we actually are*. Update it whenever a phase milestone lands or the focus shifts. If you're a new agent or contributor picking this up cold, this is the single best starting place.

---

## What's built

### Phase 0 — Setup ✅

Monorepo (pnpm 11 workspaces), repo bootstrap, doc set, Supabase project provisioned, GitHub repo, Vercel project. Done.

### Phase 1 — Single-player web ✅

- **`packages/core`** — platform-agnostic TypeScript engine. **47 / 47 tests passing** (unit + property-based with `fast-check`).
  - `types/index.ts` — domain types including `Puzzle`, `BoardState`, `Move`, `PuzzleCode` (cross-mode identifier).
  - `puzzle/board.ts` — `createBoard(puzzleCode, givens)`, `isFilled`, `cellValue`.
  - `puzzle/validator.ts` — `findConflicts` (no solution leak), `isCompleteWithSolution` (server-side use), `unitsFor`.
  - `game/notes.ts` — bitmask helpers.
  - `game/reducer.ts` — `applyMove` pure reducer + `applyMoves` replay helper. **`value` placement also auto-clears the placed digit from every peer cell's notes (row/col/box)** — always on; no setting.
  - `game/history.ts` — undo/redo wrapper. Records every cell mutated by a move (not just the target), so undo restores auto-cleaned peer notes alongside the placement. Exports `peekLastMove(history)` used by the stores' smart-clear (re-typing the just-placed value undoes instead of clearing).
- **`scripts/ingest`** — Node-only ingest. **9 / 9 tests passing**.
  - `solver.ts` — Norvig solver.
  - `code.ts` — TypeScript port of the Postgres `puzzle_code_for` function. Algorithm pinned by tests.
  - `csv.ts` — streaming CSV reader.
  - `index.ts` — bucketed sampler + Supabase insert.
  - `check-connectivity.ts` — 4 RLS sanity checks against the live project.
  - `verify-samples.ts` — verifies the bundled sample pack against the solver and the code algorithm.
- **`supabase/migrations/`** — `0001_initial.sql` → `0015_reserve_room_seqs_batch.sql` (fifteen migrations) applied to the live project via `supabase db push --linked`. The live battle + coop submit-move path depends on 0014 + 0015, so they must stay deployed (see gotcha #0). Highlights: 0006 RLS recursion fix via `is_room_member`, 0007 Realtime publications, 0008 `issued_usernames`, 0009 `player_completions` + completion RPCs, 0010 `rooms.is_public`, 0011 `room_players.has_returned`, 0012 + 0013 the six-tier difficulty rename ([#0033](DECISIONS.md)/[#0034](DECISIONS.md)), **0014 `rooms.next_seq` atomic counter + `moves.client_move_id` idempotency key + `reserve_room_seq` RPC**, **0015 `reserve_room_seqs(uuid, int)` batch RPC**. Schema documented in [ARCHITECTURE.md §4](ARCHITECTURE.md).
- **Live puzzle data:** **15,000 rows** in the `puzzles` table across **six tiers** (after the #0034 shift-rename, five visible + one hidden):
  - **warmup** (visible) — 2,500 from QQWing, rating `[-10, -5)`, clues 35–40.
  - **easy** (visible) — 2,500 from QQWing, rating `[-5, 0)`, clues 29–34. (Was labeled "beginner" pre-rename.)
  - **medium / hard / expert** (visible) — 7,500 from the Kaggle 3M radcliffe set, in radcliffe rating bands `[0, 0.75)` / `[0.75, 2.5)` / `[2.5, 5)`. (Was labeled easy / medium / hard pre-rename.)
  - **killer** (hidden — not in the picker) — 2,500 from radcliffe, rating `[5, 7)`. Reserved for a future "evil mode" surface. (Was labeled "expert" pre-rename.)
  - Rating medians: warmup -7.5, easy -2.5, medium 0.0, hard 1.7, expert 3.1, killer 5.3.
- **`apps/web`** — Next.js 15 + React 19 + Tailwind 3.
  - Routes: `/` (home with mode-first picker + public-lobby list), `/play/[code]` (SP game screen), `/r/[code]` (multiplayer lobby that switches into the battle *or* coop game on start).
  - Home flow: mode-first state machine in `home-client.tsx` — picks Single-player / Co-op / Battle first, then either the difficulty list (SP) or the Create + Join browser (multiplayer). See [DECISIONS #0035](DECISIONS.md).
  - SP components: `SudokuBoard`, `NumberPad`, `KeyboardController`, `KeyboardShortcutsOverlay`, `Timer`, `SettingsSheet`, `CompletionOverlay`, `PencilIcon`, `ActionIcons` (Eraser/Undo/Redo).
  - Battle components: `BattleBoard`, `BattleNumberPad`, `BattleKeyboardController`, `BattleWinnerOverlay`, `OpponentProgress`, `LobbySettingsPanel`, `PublicLobbyList` (mode-filterable).
  - Coop components: `CoopBoard`, `CoopNumberPad`, `CoopKeyboardController`, `CoopWinOverlay`.
  - State: Zustand stores `lib/game-store.ts` (SP), `lib/battle-store.ts` (battle), and `lib/coop-store.ts` (coop server-overlay model). Move delivery routes through `lib/move-batcher.ts` for both multiplayer modes. Completions persisted server-side in `player_completions` (chunk F) — `lib/completions.ts` wraps the `record_completion` / `get_completion_count` RPCs. (The old `lib/solved-tracker.ts` localStorage-based store was removed when completions went server-side.)
  - Puzzle loading: `lib/puzzle-source.ts` → `loadPuzzle(code)` first checks the bundled pack (`lib/sample-puzzles.ts`, used by the smoke test) then calls the Supabase RPC `sp_get_puzzle`. `listPuzzles()` pages through `puzzles_public`.
  - Picker: `lib/pick-puzzle.ts` → `pickRandomUnsolved(tier)` and `getTierCounts()`.
- **Tooling:**
  - ESLint flat config in `packages/core` blocks Next/RN/DOM/ingest imports and DOM globals.
  - Playwright smokes in `apps/web/e2e/`: `single-player.spec.ts` navigates to `/play/3santv` (bundled sample, no Supabase needed), solves it via the keyboard, and asserts the "You won!" overlay; `battle.spec.ts` is a two-context smoke (create + join + start + lobby→game routing + opponent-progress Realtime broadcast) that **only runs locally** — it needs live Supabase env and is skipped in CI.
  - GitHub Actions CI runs lint + typecheck + tests + sample/dry-run + web build + the single-player Playwright smoke on every PR and push to `main`. Latest run on `main` green.
- **Deploy:**
  - Vercel live at https://sudoku-squad-web.vercel.app/, auto-deploys from `main`. Env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) configured for Production / Preview / Development. Root directory `apps/web`.
  - Supabase CLI linked locally; future migrations push via `supabase db push --linked`.

### Verified working end-to-end

| Check | Command | Status |
|---|---|---|
| Core engine tests | `pnpm --filter @sudoku-squad/core test` | 47 / 47 |
| Ingest tests (solver + code) | `pnpm --filter @sudoku-squad/ingest test` | 9 / 9 |
| Sample-pack verification | `pnpm --filter @sudoku-squad/ingest verify:samples` | 5 / 5 |
| Ingest dry-run on synthetic fixture | `pnpm --filter @sudoku-squad/ingest ingest:dry-fixture` | sampled 5, rejected 2 (as designed) |
| Supabase connectivity + RLS | `pnpm --filter @sudoku-squad/ingest check` | 4 / 4 |
| Core lint (purity rules) | `pnpm --filter @sudoku-squad/core lint` | clean |
| Web lint | `pnpm --filter @sudoku-squad/web lint` | clean |
| Web typecheck | `pnpm --filter @sudoku-squad/web typecheck` | clean |
| Web production build | `pnpm --filter @sudoku-squad/web build` | clean |
| Playwright SP smoke | `pnpm --filter @sudoku-squad/web test:e2e single-player` | 1 / 1, ~5 s |
| Vercel prod | `curl https://sudoku-squad-web.vercel.app/` | 200, Supabase URL inlined |
| GitHub Actions on `main` | https://github.com/KyleTsai-Simek/sudoku-squad/actions | green |

---

### Phase 2 — Battle mode 🔄 (in progress)

What's landed:
- **Edge Functions** in `supabase/functions/` (deployed to the linked project):
  - `_shared/`: cors, errors, supabase clients (service-role + caller-scoped), random room-code + color-palette helpers.
  - `create-room({mode, difficulty, username})` — picks a random puzzle via `pick_random_puzzle_code` RPC, generates a unique room code (retry on conflict), inserts room + host room_player.
  - `join-room({code, username})` — looks up by code, enforces mid-game-join ([#0024](DECISIONS.md)), assigns next-free color, idempotent rejoin.
  - **`start-game({room_id})`** — host-only. Validates ≥ 2 players in battle. Transitions `lobby → playing`, sets `started_at`. Realtime broadcasts the row update.
  - **`submit-move`** — server-authoritative; accepts a single move or a batch (cap 200). Reserves seqs atomically (`reserve_room_seq` / `reserve_room_seqs`), inserts into `moves`, materializes the board (per-player in battle, shared in coop), caches `progress_pct`. Battle: progress = 100 atomically promotes the caller to `room.winner_player_id` and transitions `status → finished` (the `where status = 'playing'` guard makes a near-simultaneous winning move a clean loss). Coop: completion is a shared win.
  - `change-difficulty({room_id, difficulty})` — host-only, lobby-only; re-picks a random puzzle of the new tier ([#0035](DECISIONS.md)). Rejects `killer`.
  - `change-mode({room_id, mode})` — host-only, lobby-only; flips the room between `battle` and `coop` (backs the lobby mode toggle).
  - `claim-username`, `update-room-settings`, `kick-player`, `return-to-lobby` — the May 22 UX expansion (chunks B / D / G / H).
- **SQL helpers:**
  - `pick_random_puzzle_code(difficulty)` (SECURITY DEFINER) — never leaks solution.
  - `is_room_member(room_id)` (SECURITY DEFINER) — used by `room_players` + `moves` RLS to avoid self-referential recursion.
- **Realtime publication** — `room_players`, `moves`, `rooms` (so the lobby + game can subscribe to `postgres_changes`).
- **Web app:**
  - Home page: Solo / Battle a friend / Have a code? sections. Battle tier buttons call `create-room`. Code input calls `join-room`.
  - `lib/supabase.ts` — `ensureAuthClient()` signs visitors in anonymously, persists the session so refreshes preserve `auth.uid()`.
  - `lib/rooms.ts` — `createRoom`, `joinRoom`, `startGame`, `submitMove`, `fetchRoom`, `fetchRoomPlayers`, `fetchPuzzleGivens`, `subscribeToRoom`, `subscribeToRoomPlayers`. Result-type errors.
  - `lib/username.ts` — localStorage handle with `adj-noun-NN` default.
  - `lib/battle-store.ts` / `lib/coop-store.ts` — Zustand stores for battle and coop. Battle keeps a flat optimistic board; coop uses the server-overlay model (`remoteBoard` from seq-sorted server moves + local pendings). No solution client-side (multiplayer ≠ SP).
  - `/r/[code]` route — single page that switches between lobby and game based on `room.status` and `room.mode`:
    - **Lobby** (`lobby-client.tsx`): room code, copy-share-link, live player list, host controls (mode toggle, difficulty selector, FAB + inline Start), settings panel, kick, rename, error states (not found / full / over / in progress).
    - **Battle game** (`battle-game.tsx`): opponent progress bars, own board (`CoopBoard`/`BattleBoard`), number pad (hint omitted), keyboard controller, winner overlay (dismissible per [#0008](DECISIONS.md); losers keep solving).
    - **Coop game** (`coop-game.tsx`): shared board, per-player colored progress ([#0038](DECISIONS.md)), shared-win overlay, gap/reconnect/visibility resync.

What does NOT yet exist (Phase 2 / early Phase 3 remainder):
- **Battle smoke extension to race-to-completion + late-finish.** The minimal two-context smoke (`apps/web/e2e/battle.spec.ts`) covers create + join + start + lobby→game routing + opponent-progress Realtime broadcast. Race-to-completion is currently blocked by `submit-move` latency (~1.5s warm with the new serialization queue; 50 cells × 1.5s ≈ 75s of server drain). Options for the follow-up: optimize `submit-move`'s DB roundtrips, batch moves, or bump the test's win-detection timeout.
- **Battle UI polish** — opponent progress bars are minimal; the same-page lobby→game transition could be smoother.

The Edge Function `hint` is intentionally not shipping — Chunk A removed Hint as a feature. Lobby settings panel, return-to-lobby/play-again, kick, public lobbies, persistent completions, and "losers keep solving" all shipped in chunks D / F / G / H + the May 22 UX polish pass.

### Phase 3 — Coop mode 🔄 (MVP landed)

What's landed: shared-board coop with last-write-wins per cell by `seq`, optimistic apply + server-overlay reconciliation, idempotent batched submits, the three resync triggers ([#0037](DECISIONS.md)), and a per-player colored progress bar with the last-placer credit rule ([#0038](DECISIONS.md)). The lobby's mode toggle (`change-mode`) lets a host flip a room between battle and coop before Start.

What does NOT yet exist (Phase 3 remainder): Presence-based colored cursors, the per-player "private notes" mode ([#0007](DECISIONS.md) — may descope to V2), explicit disconnect/reconnect grace UI, and a two-tab coop Playwright smoke. The shared LWW logic currently lives in `lib/coop-store.ts` (web); lifting it into `packages/core/src/sync/` is deferred until iOS needs it.

### Beyond the current phases

- **iOS (React Native)** — Phase 4.
- **Favicon / Open Graph metadata** — placeholder Next.js favicon; no OG image yet.
- **Lighthouse / PWA-installable manifest.**
- **Mobile audit** — board fonts switched from viewport-clamp to container-query sizing (2026-05-23): cell values are `min(55cqw, 1.75rem)` and notes are `min(24cqw, 0.7rem)`, with each cell `[container-type:inline-size] overflow-hidden min-w-0 min-h-0` so glyph overflow can't perturb the grid. Verified at 320/375/1280 px; in-device confirmation still wanted.
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

0. **Migrations 0014 + 0015 must ship before the new submit-move path.** `submit-move/index.ts` calls `reserve_room_seq` (migration 0014) and `reserve_room_seqs` (migration 0015), and reads/writes `moves.client_move_id` (also 0014). Recommended deploy order: `supabase db push --linked` then `supabase functions deploy submit-move start-game`. Sanity-check schema state with `pnpm --filter @sudoku-squad/ingest verify:sync` — all 4 checks should be green.
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
pnpm --filter @sudoku-squad/core test                     # expect 47/47
pnpm --filter @sudoku-squad/ingest test                   # expect 9/9
pnpm --filter @sudoku-squad/ingest verify:samples         # expect 5 OK
pnpm --filter @sudoku-squad/ingest check                  # expect 4/4
pnpm -r typecheck                                         # expect clean
pnpm --filter @sudoku-squad/web build                     # expect clean
pnpm --filter @sudoku-squad/web test:e2e                  # expect 1/1
pnpm dev                                                  # http://localhost:3000
```

If any step fails, fix before adding features.
