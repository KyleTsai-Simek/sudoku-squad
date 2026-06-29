# Status

**Last updated:** 2026-06-27. **Confirmed lobby presence hardening is deployed on Supabase** ([DECISIONS #0050](DECISIONS.md)): migration `0026` is live, `confirm-room-presence`, `create-room`, `join-room`, `start-game`, and `submit-move` are deployed, the lobby hides unconfirmed rows from other players, and `start-game` counts only confirmed players so transient mobile in-app browser joins cannot appear as duplicate anonymous users or satisfy Battle's Start gate. The live battle + coop Playwright smoke now passes 4 / 4 after extending the lobby-count wait for the intentional 5-second confirmation delay plus Realtime lag. **Warm multiplayer rooms and late joins are implemented and the backend is deployed** ([DECISIONS #0049](DECISIONS.md)): the home page now preloads one private battle room and one private co-op room in the background, then consumes the warmed room on tap so users usually jump straight to `/r/{code}`. `join-room` now allows new players into `playing` battle and co-op rooms up to the 8-player cap; battle late joiners start from an empty private board against the original room timer, and co-op late joiners replay the shared move log and help immediately. The updated `join-room` Edge Function is deployed on the linked Supabase project, and local Playwright now includes a third-context battle late-join regression. **Web deploy follows the `main` push via Vercel.** **Daily puzzle backend and web UI are deployed** ([DECISIONS #0046](DECISIONS.md)): migrations 0020 and 0021 are live on the linked Supabase project, adding `daily_puzzles`, `player_daily_completions`, `player_completions.solve_time_ms`, daily assignment/RPC helpers keyed to midnight Pacific, and `record_single_player_completion`; 0021 fixes a PL/pgSQL output-column ambiguity in `assign_daily_puzzles`. The daily-aware `merge-progress` Edge Function is deployed. Web adds `/daily` plus a home-screen Pacific-date Daily Puzzles row with Easy / Medium / Hard, daily completion time/checkmark states, and a single-primary-CTA hierarchy that advances through the daily set before Quick Play's "Start a game"; the home subtitle was removed and Single-player difficulty buttons are centered one-word labels. **Difficulty labels are shifted and deployed** ([DECISIONS #0047](DECISIONS.md)): Warm-up becomes Easy, old Easy becomes Medium, old Medium becomes Hard, old Hard becomes Expert, and old Expert becomes Extreme; migration 0022 is live and `create-room` / `change-difficulty` accept the five visible tiers. Frontend selectors and labels share `DIFFICULTIES_VISIBLE` / `difficultyLabel`, so Single-player and lobby difficulty controls expose Easy / Medium / Hard / Expert / Extreme while daily remains Easy / Medium / Hard. **The first completion leaderboard is implemented and migrations 0023/0024/0025 are live** ([DECISIONS #0048](DECISIONS.md)): `get_completion_leaderboard` is a paged SECURITY DEFINER read model over `player_completions` joined to current `issued_usernames`, and the home page renders a bottom "Puzzles solved" top-15 with the caller's own row bolded and pinned above the list when outside the top page or still at zero solves. **Phase 5 authenticated accounts are built in this branch and the backend pieces are deployed to the linked Supabase project** ([DECISIONS #0043](DECISIONS.md)): migrations 0018 (mutable `issued_usernames` with `base`/`discriminator`) and 0019 (`get_completion_stats`) are live; `claim-username`, `set-username`, and `merge-progress` are deployed. Account hardening is underway: `pnpm --filter @sudoku-squad/ingest verify:accounts` now verifies Phase 5 columns/RPC, fresh anonymous sign-in, username claim, anonymous rename rejection, generated saved-account sessions, signed-in rename, username collision/freeing behavior, invalid/permanent-source merge rejection, anonymous-completion merge union against live Supabase, and source anonymous username cleanup after merge; `auth-store` keeps failed progress merges retryable from the Account menu instead of silently discarding the source token. Manual production testing confirmed token-hash magic-link sign-in end-to-end plus username change after an earlier PKCE `{{ .ConfirmationURL }}` failure; OTP entry, sign-out/re-sign-in, and cross-device merge still need manual/e2e coverage. Remaining Phase 5 work is tracked in [SAVED_ACCOUNTS_PLAN.md](SAVED_ACCOUNTS_PLAN.md): Supabase email template/redirect cleanup, full e2e verification of link-in-place email sign-in, real email delivery/callback behavior, sign-out/re-sign-in, and cross-device product testing. The theme refresh + dark mode work is complete ([DECISIONS #0044](DECISIONS.md), [#0045](DECISIONS.md)): web uses semantic light/dark tokens, a blue primary palette, local `auto` / `light` / `dark` preference, warm amber notes, and theme-aware player colors. The puzzle bank is 100% QQWing-generated after the [#0042](DECISIONS.md) cutover, with metadata columns from migration 0016 and the old Kaggle upper tiers cleared by 0017. Core is now **82 / 82** after notes-faithful undo/redo and username discriminator tests. Local Playwright is **6 / 6** (SP solve, SP resume, three battle specs, coop notes-sync regression).
**Daily UI note:** the Easy / Medium / Hard daily row is shared between home and the daily completion modal. Completed daily buttons show today's solved count plus solve time, and the modal immediately marks the just-finished daily as complete while promoting the next unsolved daily as primary.
**Current phase:** **Phase 5 (authenticated accounts) is the active initiative**. Phase 2 battle is fully playable end-to-end, including loser-keeps-solving, reload resume, and local two-context Playwright coverage. Phase 3 coop has an MVP landed: shared board, LWW by server seq, optimistic server-overlay reconciliation, batched/idempotent submits, delta catch-up, per-player progress, shared win, and a local two-context notes-sync smoke. Remaining product work is Phase 5 e2e verification plus coop polish (Presence cursors, private notes, disconnect/reconnect grace). iOS is the next phase.
**Branch:** `main`
**Live:** https://sudoku-squad-web.vercel.app/

**End-game share links are being revised** ([DECISIONS #0052](DECISIONS.md)): the signed `/s/{token}` implementation is being replaced with much shorter conventional `/s/{puzzleCode}/{time}` links, daily-preserving share landing pages, simpler share text, and refreshed board-card OG art. `/share-preview` remains the way to inspect share pages and direct OG image URLs without beating a puzzle. `SHARE_TOKEN_SECRET` is no longer required for new share links.

This doc captures *where we actually are*. Update it whenever a phase milestone lands or the focus shifts. If you're a new agent or contributor picking this up cold, this is the single best starting place.

---

## What's built

### Theme refresh + dark mode ✅

Complete. Web uses semantic CSS-variable theme tokens for light/dark mode, a high-contrast blue primary palette, local account-menu appearance preference (`auto` / `light` / `dark`), warm amber notes, and theme-aware player identity colors. See [ARCHITECTURE.md §1.1](ARCHITECTURE.md) and [DECISIONS #0044](DECISIONS.md) / [#0045](DECISIONS.md).

### Phase 0 — Setup ✅

Monorepo (pnpm 11 workspaces), repo bootstrap, doc set, Supabase project provisioned, GitHub repo, Vercel project. Done.

### Phase 1 — Single-player web ✅

- **`packages/core`** — platform-agnostic TypeScript engine. **82 / 82 tests passing** (unit + property-based with `fast-check`). Includes `src/sync/seq-log.ts` (move-log gap/delta helpers, 18 tests), `src/game/board-diff.ts` (`movesToReach` — the faithful undo/redo move-diff, 7 tests, [#0041](DECISIONS.md)), and `src/username/discriminator.ts` (base validation + Discord-style discriminator allocation, 10 tests, [#0043](DECISIONS.md) — imported directly by the `set-username` Edge Function as the single source of truth).
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
- **`supabase/migrations/`** — `0001_initial.sql` → `0026_room_player_lobby_presence.sql` are applied to the linked project. The live battle + coop submit-move path depends on 0014 + 0015, so they must stay deployed (see gotcha #0). Highlights: 0006 RLS recursion fix via `is_room_member`, 0007 Realtime publications, 0008 `issued_usernames`, 0009 `player_completions` + completion RPCs, 0010 `rooms.is_public`, 0011 `room_players.has_returned`, 0012 + 0013 the six-tier difficulty rename ([#0033](DECISIONS.md)/[#0034](DECISIONS.md)), **0014 `rooms.next_seq` atomic counter + `moves.client_move_id` idempotency key + `reserve_room_seq` RPC**, **0015 `reserve_room_seqs(uuid, int)` batch RPC**, **0016 QQWing metadata columns + 0017 the Kaggle→QQWing upper-tier cutover ([#0042](DECISIONS.md))**, **0018 mutable usernames**, **0019 completion stats**, **0020 daily puzzles + daily completion tracking** ([#0046](DECISIONS.md)), **0021 daily RPC ambiguity fix**, **0022 the Easy/Medium/Hard/Expert/Extreme label shift** ([#0047](DECISIONS.md)), **0023 completion leaderboard read model**, **0024 top-15 leaderboard default**, **0025 zero-solve caller row** ([#0048](DECISIONS.md)), and **0026 confirmed lobby presence** ([#0050](DECISIONS.md)). Schema documented in [ARCHITECTURE.md §4](ARCHITECTURE.md).
- **Live puzzle data:** **15,000 rows** in the `puzzles` table across **six tiers** (five visible + one hidden), **now entirely QQWing-generated** ([#0042](DECISIONS.md) replaced the Kaggle upper tiers):
  - **easy** (visible) — 2,500 from QQWing, rating `[-10, -5)`, clues 35–40; former Warm-up. ([#0033](DECISIONS.md), [#0047](DECISIONS.md))
  - **medium** (visible) — 2,500 from QQWing, rating `[-5, 0)`, clues 29–34; former Easy.
  - **hard** (visible) — 2,500 from QQWing class EASY (pure-logic, singles/hidden-singles); former Medium.
  - **expert** (visible) — 2,500 from QQWing INTERMEDIATE needing exactly **1** advanced technique (pure-logic, `guess_count = 0`); former Hard.
  - **extreme** (visible) — 2,500 from QQWing INTERMEDIATE needing **≥2** advanced techniques (still pure-logic, `guess_count = 0`); former Expert.
  - **killer** (hidden — not in the picker) — 2,500 from QQWing EXPERT (`guess_count ≥ 1`, i.e. requires a guess). Revived by [#0042](DECISIONS.md) as the requires-a-guess tier.
  - hard/expert/extreme/killer carry QQWing metadata columns (`qqwing_difficulty`, `clue_count`, `guess_count`, technique counts, `advanced_technique_count`); easy/medium carry NULLs there. "Advanced techniques" = {naked pair, hidden pair, pointing pair/triple, box-line reduction}.
- **`apps/web`** — Next.js 15 + React 19 + Tailwind 3.
  - Routes: `/` (home with mode-first picker + public-lobby list), `/daily` (Easy / Medium / Hard daily set), `/play/[code]` (SP game screen), `/r/[code]` (multiplayer lobby that switches into the battle *or* coop game on start), `/s/[code]/[time]` (short result share/challenge page), and `/share-preview` (local share/OG preview cases).
  - Home flow: mode-first state machine in `home-client.tsx` — picks Single-player / Co-op / Battle first, then either the difficulty list (SP) or the warmed-room multiplayer path. `lib/preloaded-rooms.ts` privately preloads one co-op room and one battle room after home load, so tapping either mode can navigate immediately when the background request has finished. The bottom of the home page shows the `total_completions` leaderboard via `get_completion_leaderboard`, highlighting the current player if ranked. See [DECISIONS #0035](DECISIONS.md), [#0048](DECISIONS.md), and [#0049](DECISIONS.md).
  - SP components: `SudokuBoard`, `NumberPad`, `KeyboardController`, `KeyboardShortcutsOverlay`, `Timer`, `SettingsSheet`, `CompletionOverlay`, `PencilIcon`, `ActionIcons` (Eraser/Undo/Redo).
  - Battle components: `BattleBoard`, `BattleNumberPad`, `BattleKeyboardController`, `BattleWinnerOverlay`, `OpponentProgress`, `LobbySettingsPanel`, `PublicLobbyList` (mode-filterable).
  - Coop components: `CoopBoard`, `CoopNumberPad`, `CoopKeyboardController`, `CoopWinOverlay`.
  - State: Zustand stores `lib/game-store.ts` (SP), `lib/battle-store.ts` (battle), and `lib/coop-store.ts` (coop server-overlay model). Move delivery routes through `lib/move-batcher.ts` (with retry-with-backoff) for both multiplayer modes. `lib/sp-persistence.ts` snapshots the SP game to localStorage and auto-resumes it on reload. Completions persisted server-side in `player_completions` (chunk F) — `lib/completions.ts` wraps `record_single_player_completion` / `get_completion_count`, and daily SP solves also write `player_daily_completions` when completed on the assigned Pacific day. (The old `lib/solved-tracker.ts` localStorage-based store was removed when completions went server-side.)
  - Puzzle loading: `lib/puzzle-source.ts` → `loadPuzzle(code)` first checks the bundled pack (`lib/sample-puzzles.ts`, used by the smoke test) then calls the Supabase RPC `sp_get_puzzle`. `listPuzzles()` pages through `puzzles_public`.
  - Picker: `lib/pick-puzzle.ts` → `pickRandomUnsolved(tier)` and `getTierCounts()`.
- **Tooling:**
  - ESLint flat config in `packages/core` blocks Next/RN/DOM/ingest imports and DOM globals.
  - Playwright smokes in `apps/web/e2e/`: `single-player.spec.ts` navigates to `/play/3santv` (bundled sample, no Supabase needed), solves it via the keyboard, and asserts the "You won!" overlay; `sp-resume.spec.ts` fills cells, reloads, and asserts the in-progress game auto-resumes from localStorage (also bundled-sample / CI-safe); `battle.spec.ts` is a two-context smoke (create + join + start + lobby→game routing + opponent-progress Realtime broadcast + a fill→undo→redo progress-sync check per [#0039](DECISIONS.md)), a **mid-battle reload regression** (fill cells → reload → assert the private board *and* `ownProgressPct` are re-materialized from the player's own server move log, not reset to an empty grid), and a **late-join regression** (third player joins an already-started battle, sees all players, and starts from 0%); `coop.spec.ts` is a two-context coop smoke (create + join + start + shared-board sync + the [#0041](DECISIONS.md) notes-undo regression guard: a peer note auto-cleared by a value placement must reappear on the *other* client after undo, checked via a full-log re-materialize on reload). Both multiplayer smokes **only run locally** — they need live Supabase env and are skipped in CI; off-CI Playwright runs single-worker so the live two-context/three-context specs don't contend on Realtime.
  - GitHub Actions CI runs lint + typecheck + tests + sample/dry-run + web build + the single-player Playwright smoke on every PR and push to `main`. Latest run on `main` green.
- **Deploy:**
  - Vercel live at https://sudoku-squad-web.vercel.app/, auto-deploys from `main`. Env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) configured for Production / Preview / Development. Root directory `apps/web`.
  - Supabase CLI linked locally; future migrations push via `supabase db push --linked`.

### Verified working end-to-end

| Check | Command | Status |
|---|---|---|
| Core engine tests | `pnpm --filter @sudoku-squad/core test` | 82 / 82 |
| Ingest tests (solver + code) | `pnpm --filter @sudoku-squad/ingest test` | 9 / 9 |
| Sample-pack verification | `pnpm --filter @sudoku-squad/ingest verify:samples` | 5 / 5 |
| Ingest dry-run on synthetic fixture | `pnpm --filter @sudoku-squad/ingest ingest:dry-fixture` | sampled 5, rejected 2 (as designed) |
| Supabase connectivity + RLS | `pnpm --filter @sudoku-squad/ingest check` | 4 / 4 |
| Account infrastructure | `pnpm --filter @sudoku-squad/ingest verify:accounts` | live schema + anonymous account smoke green |
| Core lint (purity rules) | `pnpm --filter @sudoku-squad/core lint` | clean |
| Web lint | `pnpm --filter @sudoku-squad/web lint` | passes with one existing `react-hooks/exhaustive-deps` warning in `lobby-client.tsx` |
| Web typecheck | `pnpm --filter @sudoku-squad/web typecheck` | clean |
| Web production build | `pnpm --filter @sudoku-squad/web build` | passes with the same lint warning |
| Playwright e2e | `pnpm --filter @sudoku-squad/web test:e2e` | 5 / 5 locally |
| Vercel prod | `curl https://sudoku-squad-web.vercel.app/` | 200, Supabase URL inlined |
| GitHub Actions on `main` | https://github.com/KyleTsai-Simek/sudoku-squad/actions | green |

---

### Phase 2 — Battle mode 🔄 (in progress)

What's landed:
- **Edge Functions** in `supabase/functions/` (deployed to the linked project):
  - `_shared/`: cors, errors, supabase clients (service-role + caller-scoped), random room-code + color-palette helpers.
  - `create-room({mode, difficulty, username})` — picks a random puzzle via `pick_random_puzzle_code` RPC, generates a unique room code (retry on conflict), inserts room + host room_player.
  - `join-room({code, username})` — looks up by code, seats lobby and in-progress joiners up to 8 players, assigns next-free color, and keeps rejoin idempotent ([#0049](DECISIONS.md)). Finished rooms reject new joiners.
  - `confirm-room-presence({room_id})` — marks a durable `room_players` seat visible after the client remains in the room for a few seconds ([#0050](DECISIONS.md)). Deployed with migration 0026.
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
  - Home page: Solo / Battle a friend / Have a code? sections. Multiplayer mode buttons consume private warmed rooms when available, falling back to `create-room`. Code input calls `join-room`.
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

What does NOT yet exist (Phase 3 remainder): Presence-based colored cursors, the per-player "private notes" mode ([#0007](DECISIONS.md) — may descope to V2), and explicit disconnect/reconnect grace UI. The shared LWW logic currently lives mostly in `lib/coop-store.ts` (web), with pure seq-log helpers already lifted into `packages/core/src/sync/`; lifting materialization/overlay/ownership is deferred until iOS needs it.

### Beyond the current phases

- **iOS (React Native)** — Phase 4.
- **Favicon / generic Open Graph metadata** — placeholder Next.js favicon; generic site-level OG image remains pending. Result-specific OG images are implemented for short `/s/[code]/[time]` shares.
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
- **Late joins** — battle and coop both accept new players after Start up to the 8-player cap ([#0049](DECISIONS.md)). Battle late joiners are behind on elapsed time because `started_at` is unchanged; coop late joiners replay the shared log and help immediately.

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
9. **Sync resilience gaps are catalogued — see [TODO.md](TODO.md) "Sync resilience hardening".** A 2026-05-29 architecture audit found three gaps; the first two are now **fixed** (2026-05-29): (a) ✅ the `rooms` / `room_players` subscriptions now have reconnect + visibility + 8s-poll recovery (`subscribeToRoom`/`subscribeToRoomPlayers` take an `onReconnect`; lobby-client wires the rest) — previously a dropped channel could strand a player in the lobby or hide the winner; (b) ✅ `hasSeqGap` no longer false-positives on abandoned seqs (coop-store tracks `knownMissingSeqs`, recomputed from each authoritative snapshot). Still open: (c) submit failures resync immediately instead of retrying despite having idempotency keys — folded into the durable-local-log + delta-catch-up track in TODO. Don't re-derive these.

---

## How to verify the environment is healthy

```bash
cd /Users/kylets/sudoku-squad
pnpm install                                              # idempotent
pnpm --filter @sudoku-squad/core test                     # expect 82/82
pnpm --filter @sudoku-squad/ingest test                   # expect 9/9
pnpm --filter @sudoku-squad/ingest verify:samples         # expect 5 OK
pnpm --filter @sudoku-squad/ingest check                  # expect 4/4
pnpm -r typecheck                                         # expect clean
pnpm --filter @sudoku-squad/web build                     # expect pass (currently one lint warning)
pnpm --filter @sudoku-squad/web test:e2e                  # expect 5/5 locally
pnpm dev                                                  # http://localhost:3000
```

If any step fails, fix before adding features.
