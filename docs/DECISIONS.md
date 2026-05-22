# Decisions

A lightweight Architecture Decision Record. Each decision has: context, the choice, alternatives, and consequences. Add new entries at the **top** (newest first). Don't edit old entries — supersede them with a new one.

Format:

```
## NNNN — Title
**Date:** YYYY-MM-DD
**Status:** Accepted | Superseded by #MMMM | Open

**Context.** Why we needed to decide.
**Decision.** What we picked.
**Alternatives considered.** Briefly, and why we passed.
**Consequences.** What follows.
```

---

## 0031 — Re-bucketing the puzzle bank: 4 tiers, per-(tier, clues) targets
**Date:** 2026-05-22
**Status:** Accepted

**Context.** The original V1 bank was 7,500 puzzles (2,500 easy/medium/hard, 0 expert) sampled by streaming the Kaggle 3M CSV in order and admitting the first 2,500 hits per rating band. An audit found this skewed easy heavily toward rating 0 (53% of easy were exactly rating 0.0) and left expert empty because the old band `rating > 7.0` matches only ~100 of 3M rows. We also wanted a clue-count gradient: easy should have more clues, expert fewer, matching how players think about difficulty.

**Decision.** New bands (half-open `[lo, hi)`), all 2,500 puzzles:

- `easy`   `[0.0, 1.5)`
- `medium` `[1.5, 4.0)`
- `hard`   `[4.0, 5.0)`
- `expert` `[5.0, 7.0)`

Rows with `rating ≥ 7.0` are skipped entirely — they're outside every band, and the old "fall back to clue count" path was silently admitting them to expert. The new `difficultyForRow` returns `null` when the rating doesn't fall in a band, and the loop skips on null.

Within each tier, a per-clue-count target distribution (`TARGET_PER_CELL` in `scripts/ingest/src/index.ts`) biases the bank: easy mode at 27 clues, expert mode at 22–23 clues, both with intentional spread across the dataset's 20–28 clue support. Each (tier, clue) cell's target was confirmed feasible against the 3M source via a preflight scan (`pnpm preflight:3m`).

Resulting bank: 10,000 puzzles, exactly 2,500 per tier. Clue medians shift cleanly: easy 27, medium 25, hard 23, expert 23. Rating medians shift cleanly: easy 0.0, medium 2.2, hard 4.3, expert 5.3.

**Alternatives considered.**
- **Stronger lean (e.g., expert mode at 21 clues).** Constrained by source: only 87 of 3M rows are 21-clue + rating 5.0+. We take all 87, but going further would require either more total expert rows (which leaves less variance) or padding from outside the rating band (defeats the purpose).
- **Preserve the raw rating on each `puzzles` row.** Considered for future analytics — would require a migration adding `rating numeric`. Deferred; the bucket label is sufficient for V1 gameplay.
- **Skip the re-ingest, re-bucket in-place.** Doesn't help: the rating data isn't stored on the row, only the tier label, and the existing rows were heavily biased toward rating 0 inside easy.

**Consequences.**
- Truncated `puzzles`, `player_completions`, and `rooms` (which cascades through `room_players` and `moves`). No real users yet, so no migration story needed beyond "any in-flight battle room is gone." Acceptable for V1.
- The `puzzles` row count is now **10,000** (was 7,500). The home page `listPuzzles()` still pages the full set with 1k-page PostgREST batches.
- Supersedes the old [DECISIONS #0018](DECISIONS.md) reasoning that expert was deferred pending a richer puzzle source — we now have a usable expert tier (5.0–7.0 rating) from the existing 3M dataset. A true "evil" tier (rating 7+) remains future work.
- New utility scripts: `pnpm --filter @sudoku-squad/ingest preflight:3m` (scan source distribution) and `pnpm --filter @sudoku-squad/ingest audit:difficulty` (audit the live DB). Both are idempotent + read-only (except the live `ingest --truncate` itself).

---

## 0030 — Return-to-lobby cycle: same room, `has_returned` per player
**Date:** 2026-05-22
**Status:** Accepted

**Context.** After a battle/coop ends, players want to play again with the same group. Two natural shapes: cycle the same room (status `lobby → playing → finished → lobby`) or create a fresh room each round. Players might also be at different rates — the winner is done immediately but a losing player may want to finish solving their own board first.

**Decision.** Same room cycles. Add `room_players.has_returned boolean default true`. When `room.status` transitions `playing → finished`, server flips every player's `has_returned = false`. A `return-to-lobby` Edge Function flips the caller's `has_returned = true` and transitions `room.status → lobby` if it isn't already. Players who haven't returned render greyed-out with a 3-dot waiting animation; the host can kick non-returned players to start sooner.

The host's "Start new game" succeeds only when every player has `has_returned = true`. The same `start-game` Edge Function does the reset: clears moves, picks a new random puzzle for the room, resets every `progress_pct` to 0, clears `winner_player_id` + `finished_at`, sets a new `started_at`.

**Alternatives considered.**
- **New room each round.** Cleaner per-game state; cheaper to reason about. Rejected because URL changes mid-flow feel less like "same room" and we'd need to broadcast the new room code to all current players.
- **Force everyone to finish before lobby reopens.** Stricter; punishes the winner with a wait.
- **Just navigate back to home and have everyone manually rejoin the same code.** Works, but it's friction.

**Consequences.**
- Two new state transitions on `rooms`: `finished → lobby` (idempotent) and `lobby → playing` (already exists but now usable on a previously-played room — the function clears prior state). Both must be atomic with respect to other writers.
- `moves` is wiped on each new game. That's fine — the move log is per-game; we don't yet have a "match history" feature that needs to keep it.
- This subsumes the "losers can keep solving" item ([previously task #27](TODO.md)): the loser sees the same finished-game UI until they explicitly click "Return to lobby". They can keep typing into their board until then. The server already refuses `submit-move` on `status='finished'`, so late typing is local-only; a later polish pass can make `submit-move` permissive for losers on finished rooms.

---

## 0029 — Public lobbies + host kick
**Date:** 2026-05-22
**Status:** Accepted

**Context.** Friend-and-family invites work via shared link, but discovery is also useful — open a room so anyone can join. Hosts need a kick to handle griefers or no-shows.

**Decision.** Two related additions:

- **`rooms.is_public boolean default false`.** Host toggles in the lobby. Public rooms appear in a new "Public lobbies" list on the home page (rooms whose `is_public = true` AND `status IN ('lobby', 'playing')`). The list refreshes via a Realtime subscription on `rooms`.
- **`kick-player({room_id, player_id})` Edge Function.** Host-only. Deletes the target row from `room_players`. The target's existing `room_players` subscription sees the delete and the client redirects them home with a message.

**Alternatives considered.**
- **Always-private; friend invites only.** Simpler but loses the discovery vibe that makes the multiplayer feel like a community.
- **Ban list per room.** Would let a kicked player not rejoin. Defer — repeat kick is acceptable for V1.

**Consequences.**
- No RLS change is needed for public listing — `rooms_read_all` already lets anon read every room. The home page just filters by `is_public = true`.
- Kick is destructive. The Edge Function is the authority — RLS doesn't need to grant the delete to clients.
- Public lobbies need light moderation later (username profanity filter — see Open Questions). Not blocking V1 since the kick is host-controlled.

---

## 0028 — Per-player puzzle completions stored server-side
**Date:** 2026-05-22
**Status:** Accepted (supersedes the localStorage-only solved tracker in `lib/solved-tracker.ts`)

**Context.** Today, "don't re-serve solved puzzles" lives in `localStorage` (`sudokusquad:solved`). It works for SP but doesn't survive a cleared cache, doesn't sync across devices, and doesn't count completions earned in multiplayer toward the same player. We also want a public-facing "you've solved N puzzles" count on the home page.

**Decision.** New table `player_completions(player_id uuid, puzzle_code text, mode text, completed_at timestamptz, primary key (player_id, puzzle_code))`. Server is the source of truth:

- `submit-move` inserts on the player's first win (multiplayer). `on conflict do nothing` so re-solves don't duplicate.
- New RPC `record_completion(p_code text, p_mode text)` for single-player. Called by `CompletionOverlay` once `isCompleteWithSolution` returns true. Same `on conflict do nothing`.
- Loser late-finishes (per [#0030](#0030)) also fire `record_completion`.
- New RPC `get_completion_count()` for the home page count. SECURITY DEFINER — reads only the caller's own rows via `auth.uid()`.
- "Don't re-serve solved" filter now reads from this table.

The local `solved-tracker.ts` can stay as a short-lived optimistic cache (avoids round-trip on the home page), but the DB is authoritative.

**Alternatives considered.**
- **localStorage only.** What we have today. Discarded for the reasons above.
- **A counter column on `auth.users`.** Cheaper read; can't distinguish which puzzles are solved (we'd lose dedupe).
- **One row per player+mode.** Doesn't dedupe across modes.

**Consequences.**
- Anonymous user identity is stable enough that this works in practice; if a player clears storage they get a new `auth.uid()` and the count restarts (acknowledged limitation of anon auth per [#0006](#0006)).
- Realtime subscription on `player_completions` could power a live count badge, but the home-page count is fetched once on mount.

---

## 0027 — Persistent client-generated username from a bundled wordlist
**Date:** 2026-05-22
**Status:** Accepted (supersedes the inline `adj-noun-NN` generator in `lib/username.ts`)

**Context.** The initial implementation generated names client-side from a small inline 15-adjective × 15-noun list with a numeric suffix. We want a much larger wordlist for variety and to drop the numeric suffix when there's enough alphabetic uniqueness.

**Decision.** A two-column CSV at `apps/web/lib/data/usernames.csv` (one row per pair slot; columns may be different lengths — short ones padded blank). A build-time script `scripts/build-word-lists.ts` converts the CSV into `apps/web/lib/data/word-lists.generated.ts` (committed). `lib/username.ts` imports the two arrays from that module; first-time visitors get a random `adj-noun` (no suffix unless wordlist size is small enough that collisions matter at our scale). localStorage continues to cache the chosen name.

**Alternatives considered.**
- **Server-generated names.** Round-trip on first visit; would require an Edge Function. Overkill.
- **Bundle the CSV as a raw asset.** Wordlists are small enough that a generated TS module is fine and avoids a runtime CSV parser in the bundle.
- **Numeric suffix always.** Loses the "real name" vibe. We'll add it back only if collisions become observable.

**Consequences.**
- The committed `.generated.ts` is the source the bundle reads; the raw CSV is for editability. Gitignore the CSV only if it's large (the build script regenerates from it).
- Future: optional "rename" Edge Function with profanity filter for public-launch hygiene ([open question #1](DECISIONS.md)).

---

## 0026 — Multiplayer max-players = 8 + 8-color palette
**Date:** 2026-05-22
**Status:** Accepted

**Context.** Original schema had no explicit max-player cap; the `join-room` Edge Function caps at 4. We're bumping the cap and the color palette together because the per-player color is allocated from the palette.

**Decision.** Cap = 8 in `join-room`. Color palette = 8 hex values chosen for visual distinctness at the 9 × 9 grid scale and reasonable accessibility contrast on white:

```
amber-500   #f59e0b   (warm yellow-orange)
sky-500     #0ea5e9   (light blue)
emerald-500 #10b981   (green)
rose-500    #f43f5e   (red-pink)
violet-500  #8b5cf6   (purple)
orange-600  #ea580c   (deep orange, distinct from amber)
teal-500    #14b8a6   (blue-green, distinct from sky/emerald)
fuchsia-500 #d946ef   (magenta)
```

**Alternatives considered.**
- **Stay at 4.** Simple, but limits coop discovery and public-lobby filling. 8 still feels manageable for cursor crowding in coop.
- **Cap at 6.** Common in similar apps (Down for a Cross, etc.). Reasonable but doesn't add much over 8 if the palette can sustain 8.
- **Dynamic palette / user-picked colors.** Adds friction; deferred to a hypothetical "customize your appearance" flow much later.

**Consequences.**
- `join-room` rejects the 9th joiner with `room_full`.
- The palette lives in `supabase/functions/_shared/room-code.ts` (`nextColor` picks the first unused). Same list referenced by the lobby UI for legend purposes.
- Battle-mode opponent progress bars work fine with up to 8 stacked rows.

---

## 0025 — Disconnect grace period: 2 minutes
**Date:** 2026-05-22
**Status:** Accepted

**Context.** The original ARCHITECTURE.md plan was 60 s. That's tight on mobile networks where a tunnel pop, screen lock, or 5G→LTE handoff can take ~30 s on its own.

**Decision.** A player has **120 s (2 minutes)** from disconnect to rejoin and pick up where they left off without their seat being freed. After that:
- In **battle**, their seat is freed; the game continues for everyone else.
- In **coop**, their seat is freed; their cursor disappears; the room continues.

Their move log is preserved either way — rejoining within the same room code restores their state.

**Alternatives considered.**
- **60 s.** Reasonable on desktop home wifi, frustrating on mobile.
- **5 minutes.** Generous, but holds an empty seat for far too long if someone genuinely abandoned.
- **No grace period (instant drop).** Simplest, but a single tunnel pop drops a player out of a tight battle.

**Consequences.** The lobby UI shows a "reconnecting…" badge during the grace window. The cleanup runs as a server-side timer (or on the next move from any other player — easiest is the latter). When the timer fires, server broadcasts a `player_left` event on the room channel.

---

## 0024 — Mid-game join policy: battle locks at Start, coop is open
**Date:** 2026-05-22
**Status:** Accepted

**Context.** Need to decide what happens when someone clicks a battle/coop room link after the game has already started. Letting joins continue mid-race is unfair (a fresh player has an unbeatable head start in battle). Letting them join mid-coop is fine and often desirable.

**Decision.**
- **Battle.** Once `rooms.status` transitions to `'playing'`, `join_room` refuses new joiners with a `room_in_progress` error. The client renders a "this battle has already started — start a new one" screen with a "New game" CTA.
- **Coop.** Joining is allowed at any time during `'lobby'` or `'playing'`. The new player picks up the current board state on join.
- **Finished rooms.** Both modes refuse joins with `room_finished`. The client offers "Play again" (creates a fresh room with the same players invited).

**Alternatives considered.**
- **Lock both at Start.** Symmetric and simple, but loses the "drop in to help" coop feel.
- **Open both, with battle starting newcomers from scratch.** Newcomer can't catch up; effectively eliminated before they start typing. Worse UX than refusing.
- **Battle: allow late join, count toward "didn't win" but no penalty.** Adds a third loser type and complicates the winner overlay.

**Consequences.**
- `join_room` Edge Function checks `(room.status, room.mode)` and returns one of three states: `ok` / `room_in_progress` / `room_finished`.
- The lobby route renders three branches off this state. Lobby copy is mode-aware.
- "Play again" creates a *new* room — preserves the move log of the old one for any future stats feature.

---

## 0023 — Edge Functions (not SQL RPCs) for multiplayer endpoints
**Date:** 2026-05-22
**Status:** Accepted

**Context.** Multiplayer needs `create_room`, `join_room`, `submit_move`, `check_completion`, `hint`. Each is a small bit of server-authoritative logic that validates inputs, mutates state across multiple tables, and (for `submit_move`) broadcasts on a Realtime channel. SQL RPCs (PL/pgSQL functions exposed via PostgREST) are the lighter alternative.

**Decision.** All multiplayer endpoints are **TypeScript Edge Functions** in `supabase/functions/`. Each function uses the service-role key to bypass RLS and is the sole authority for its mutation. PostgREST and RPCs (`sp_get_puzzle`) keep their narrow role: simple reads / single-player solution delivery.

**Alternatives considered.**
- **SQL RPCs (PL/pgSQL).** Smaller stack, faster cold start (no Deno). But: the move-validation logic (compute correctness without leaking solution to the client; check completion; broadcast on a Realtime channel) is harder to express in PL/pgSQL than TS. Test setup is also worse — no obvious unit-test path.
- **Mixed: simple ones as RPCs, complex ones as Edge Functions.** Two patterns to remember. Cost of consistency > cost of one extra Deno cold start.
- **Roll our own Node server.** Most flexibility, defeats the point of choosing Supabase.

**Consequences.**
- One toolchain (Deno + `supabase functions serve` for local dev, `supabase functions deploy` for ship). One auth pattern (functions take the user's anon JWT, derive `auth.uid()` from it server-side; service-role client for the actual mutation).
- Cold starts on Supabase Edge Functions are ~150–250 ms; acceptable for the cadence of game events (`submit_move` is hot enough to stay warm; `create_room` only runs once per game).
- All five functions live under `supabase/functions/` and share a `_shared/` utilities module (Supabase client constructors, error shape, etc.).

---

## 0022 — Single-player gets the solution; multiplayer never does
**Date:** 2026-05-22
**Status:** Accepted

**Context.** Hint and "auto-check" need to know the correct cell value. In single-player there's no other player to cheat against, so doing this check client-side is fine. In multiplayer it's anti-cheat-critical that `puzzles.solution` never reach the client.

**Decision.** Two distinct paths, deliberately *not* unified:

| Mode | How the client gets answers |
|---|---|
| Single-player (`/play/[code]`) | Calls the SECURITY DEFINER RPC `sp_get_puzzle(p_code)` which returns the full row including `solution`. The client uses the solution for hint, auto-check, and completion check locally. |
| Battle / coop (Phase 2+) | Client fetches givens via `puzzles_public` (no `solution` column) and goes through Edge Functions for hint reveal, server-validated cell-correct checks, and completion. `solution` never leaves the server. |

Multiplayer code MUST NOT call `sp_get_puzzle`. The RPC's comment in migration 0003 calls this out; we'll re-check it in code review when Phase 2 lands.

**Alternatives considered.**
- **Unify the path** — make SP also go through Edge Functions and stop returning the solution. Cleaner but doubles the Phase 1 effort (Edge Functions weren't needed for anything else) and gains no real security (SP has no one to cheat against).
- **Never return the solution, even in SP** — kill the hint feature in SP entirely. Worse UX.
- **Mix: SP also uses Edge Functions, but they're permissive** — confusing dual-purpose endpoints.

**Consequences.**
- A player who solved a puzzle in SP and later joins a coop room with the *same* puzzle has a slight advantage (they remember the answers). We accept this; V1 doesn't try to prevent self-spoiling.
- `sp_get_puzzle` is V1-only baggage if Phase 2 builds the same Edge Function hint flow for multiplayer. Once the multiplayer hint path exists, we *could* migrate SP onto it — kept as a future refactor. Until then the dual path is the simplest thing that works.
- The RPC is gated only by `grant execute … to anon`. Anyone can call it for any puzzle code. Acceptable for SP. If we ever want SP to also gate by player session, that becomes an Edge Function.

---

## 0021 — Room codes: 6-char lowercase base36, randomly generated
**Date:** 2026-05-22
**Status:** Accepted

**Context.** Multiplayer rooms need shareable codes for URLs like `/r/{code}`. Format choices: alphabet (Crockford base32, base36, base64-url), length, generation (random vs deterministic vs sequence).

**Decision.** Match the puzzle-code shape: **6 characters, lowercase base36 (0-9a-z), randomly generated**, unique in `rooms.code`. On collision, retry.

| Property | Value |
|---|---|
| Length | 6 |
| Alphabet | `0-9a-z` |
| Generation | Random (per `gen_random_bytes` or equivalent) |
| Collision retry | Yes — `rooms.code unique` enforces it, server retries on conflict |
| Lifetime | Tied to the room row; codes can be recycled after `rooms` is cleaned up |

**Alternatives considered.**
- **Crockford base32 (no I/L/O/U).** Friendlier when shared verbally. Rejected: rooms are shared via link, not voice; the cost of a second alphabet to remember isn't worth the marginal disambiguation.
- **Uppercase to visually distinguish from puzzle codes.** Cute but unnecessary — different URL paths (`/play/` vs `/r/`) prevent any real confusion.
- **UUIDs in the URL.** Too long; ugly.
- **Sequential / pretty short IDs.** Leak room creation cadence, no real benefit.

**Consequences.**
- Room and puzzle codes share a format. They live in different tables and different URL paths — no actual collision risk in URLs. A code string in isolation is ambiguous (you'd need to know if it's a `/play/` or `/r/` URL), but we never share codes in isolation.
- 36^6 ≈ 2.18B distinct codes. At any plausible concurrent-room count, collision probability is microscopic. The `unique` constraint catches the impossible case; the Edge Function retries with a fresh random.
- Phase 2 `create_room` Edge Function is the only place that generates these.

---

## 0020 — Puzzle code is the cross-mode puzzle reference (rooms.puzzle_code FK)
**Date:** 2026-05-22
**Status:** Accepted

**Context.** Migration 0001 declared `rooms.puzzle_id uuid references puzzles(id)`. Migration 0003 added `puzzles.code text unique` as the URL/short-share identifier. We now had two ways to reference a puzzle from a room (UUID and code) with no clear winner. Multiplayer is about to start using this column.

**Decision.** Rooms reference puzzles by `puzzle_code text references puzzles(code)`. Drop `rooms.puzzle_id`. The puzzle code is the single cross-mode identifier:

| Use | Identifier |
|---|---|
| Internal Postgres PK | `puzzles.id` (uuid) |
| URL slug for SP | `puzzles.code` → `/play/[code]` |
| URL slug for multiplayer rooms | `rooms.code` → `/r/[code]` (different namespace) |
| `rooms` reference to its puzzle | `rooms.puzzle_code` (FK to puzzles.code) |
| Move log scope | `rooms.id` (uuid, unchanged) |
| In-app `BoardState` identifier | `puzzleCode` (was `puzzleId`) |
| In-repo sample puzzles | pinned to the same hash |

Applied as migration `0004_rooms_puzzle_code_fk.sql`. `rooms` was empty in production so no data migration was needed.

**Alternatives considered.**
- **Keep both** (`puzzle_id` AND `puzzle_code` denormalized for read speed). Two identifiers for the same thing is exactly the conflation we wanted to remove. Skipped.
- **Keep only `puzzle_id`, never reference by code in the schema.** Forces every admin query / log line to JOIN to display the readable identifier. The code became the human-facing identifier the moment we built `/play/[code]`; the schema should reflect that.
- **Drop the UUID entirely** (use code as the PK on `puzzles`). Tempting but riskier — UUID PKs play nicely with Supabase tooling, RLS examples, and the future case where someone re-hashes a puzzle and we want to keep the row identity stable across the rename.

**Consequences.**
- `core.BoardState.puzzleId` was renamed to `puzzleCode`. `createBoard(puzzleCode, givens)`. The DB UUID isn't carried in the client at all — we never needed it client-side.
- The `puzzles.id` uuid stays as the internal PK. It's used by `moves`-as-yet-unbuilt (per Phase 2 design `moves.room_id` references `rooms.id`, no puzzle_id needed there).
- `puzzles_public` still exposes both `id` and `code` to clients. The `id` is now dead client-side surface — could be removed in a future migration if we want a tighter API, but it doesn't cost anything to leave.
- Schema is now: puzzle = `(id uuid, code text unique)`, room = `(id uuid, code text unique, puzzle_code text fk)`.

---

## 0019 — Puzzle codes: 6-char deterministic base36 hash of givens
**Date:** 2026-05-22
**Status:** Accepted

**Context.** The single-player flow needs a short, URL-friendly puzzle identifier — short enough to share comfortably, opaque enough that "puzzle 1" doesn't leak ordering, deterministic so the same puzzle always has the same id across re-ingests and so the in-repo sample puzzles can match Supabase rows.

**Decision.** `code = base36( first 40 bits of md5(concat(givens)) mod 36^6 )`, padded to 6 chars. Lowercase a-z + 0-9. Stored as `puzzles.code text not null unique`, indexed.

| Property | Value |
|---|---|
| Length | 6 |
| Alphabet | `0-9a-z` (base36) |
| Collision space | 36^6 ≈ 2.18B |
| P(collision) at 7 500 rows | ~1.3e-5 (negligible) |
| P(collision) at 1 M rows | ~0.0002 (0.02 %) |
| P(collision) at 10 M rows | ~0.023 (2.3 %) |

Computed identically in Postgres (PL/pgSQL `puzzle_code_for(smallint[])`) and TypeScript (`scripts/ingest/src/code.ts`). The TS test `code.test.ts` pins two hashes; if the algorithm ever changes both must move together AND we re-hash existing rows in a follow-up migration.

**Alternatives considered.**
- **nanoid(6) random alphabet.** Larger collision space (64^6 ≈ 68 B) so safer at scale, but not deterministic — re-ingest produces different codes, and the in-repo sample pack would need bespoke codes that drift from Supabase.
- **Sequential base36 of `bigserial`.** Shortest possible (~4 chars at 1 M, ~5 at 10 M), no collision risk. Rejected because it leaks total puzzle count and ordering, and is awkward to compute for in-repo samples.
- **8 chars instead of 6.** Comfortably collision-free at 10 M+ scale. Rejected as longer than necessary for our planned scale.
- **Crockford base32 (no I/L/O/U).** Smaller alphabet (32) gives slightly less collision headroom; the disambiguation only matters for verbally-shared codes. URLs make it moot.

**Consequences.**
- URLs look like `/play/cbotju`. Short, shareable, opaque.
- If we ever scale past ~1 M live puzzles, collision probability becomes noticeable (~0.02 %). The unique constraint catches it; the TS ingest needs to gain a retry-with-salt path. The migration's safety-net `do $$` block does this for the initial backfill.
- The same algorithm runs at ingest time (to compute the code before insert) and in `apps/web/lib/sample-puzzles.ts` (codes pinned to compile-time values). `verify-samples` checks the pinning.

---

## 0018 — V1 puzzle pool: 7 500 rows from the Kaggle 3M dataset, no expert tier yet
**Date:** 2026-05-22
**Status:** Accepted (supersedes parts of [#0011](#0011))

**Context.** The actual ingest had to choose: (a) which Kaggle variant to mine, (b) how many puzzles to take, (c) what difficulty mix. We dry-ran against the user-selected dataset, `radcliffe/3-million-sudoku-puzzles-with-ratings`, before committing to an insert.

**Decision.** Ingest 7 500 puzzles — 2 500 each in `easy` / `medium` / `hard`. Expert tier target is **0** for now. Difficulty is read from the dataset's numeric rating with these cut points:

| Tier | Rating |
|---|---|
| easy | ≤ 2.5 |
| medium | 2.5 – 5.0 |
| hard | 5.0 – 7.0 |
| expert | > 7.0 |

**Alternatives considered.**
- Use the 1M Kaggle dataset (`bryanpark/sudoku`). Smaller, no difficulty column — we'd have to derive difficulty from clue count. The 3M dataset has both rating and clue count, so it's a strict superset of useful signal.
- Target 10 000 puzzles (2 500 × 4 tiers). Rejected because the 3M dataset only has ~100 puzzles rated > 7.0 — not enough for a meaningful expert sample. Sampling forced rebucketing of "expert" to mean something looser than the standard sudoku-app definition, which we'd rather not do.
- Skip the rating column and bucket purely by clue count. Rejected because this dataset's clue counts cluster in 22–26, so clue-count buckets all collapse into hard/expert — wouldn't give us an easy tier at all.

**Consequences.**
- Live `puzzles` table has 7 500 rows. Web single-player still uses the bundled pack until the Supabase fetch lands.
- Expert tier is empty in V1. If/when we want one, we either (a) source from a different high-difficulty pack and re-run with `expert = 2500`, or (b) loosen the threshold (would re-bucket what "expert" means).
- The 535 MB source CSV is gitignored in `scripts/ingest/data/sudoku-3m.csv`. Re-running the ingest later picks up wherever it left off (it appends; truncate manually for a clean slate).
- The `puzzles_public` view had to be re-created in migration 0002 to make this useful — the original `security_invoker = true` setting made the view return zero rows to anon.

---

## 0017 — Bundled sample-puzzle pack as the single-player source until ingest lands
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Phase 1 single-player UI was ready to build before the Kaggle dataset was ingested. The `puzzles` table is empty. We needed *some* puzzles to play against so the UI work could be developed and verified end-to-end without blocking on the multi-GB dataset download.

**Decision.** Ship a small hand-picked pack in `apps/web/lib/sample-puzzles.ts` (currently 5 puzzles across easy/medium/hard). Each puzzle is verified by the Norvig solver via `scripts/ingest/src/verify-samples.ts` (`pnpm --filter @sudoku-squad/ingest verify:samples`) to have a unique solution and a matching answer. Solutions live client-side in the bundled file — this is intentional for single-player because there is no one to cheat against.

When the Kaggle ingest lands and `puzzles` is populated, single-player switches to fetching from `puzzles_public` (no solution column) and uses the same server-side completion check that multiplayer will use. The bundled pack can stay as an offline fallback for dev, or be deleted.

**Alternatives considered.**
- Block UI work until ingest finishes. Linear but slower — the dataset download + sampling is its own chunk of work and we'd lose the chance to verify the UI in parallel.
- Manually insert a few rows directly into Supabase via SQL. Equivalent net effect but ties dev to a network call and credentials.
- Generate puzzles on the fly. Out of scope — see [#0011](#0011) and [#0012](#0012).

**Consequences.** The web app ships with a small bundled puzzle pack as long as `lib/sample-puzzles.ts` exists. The hint feature in single-player works because the bundled solution is local; this code path will need to change to a server RPC the moment we switch to Supabase puzzles. Documented in [STATUS.md](STATUS.md) gotcha #7.

---

## 0016 — pnpm 11 build-script approval via `allowBuilds:` in `pnpm-workspace.yaml`
**Date:** 2026-05-21
**Status:** Accepted

**Context.** pnpm 10+ defaults to NOT running postinstall scripts for native-binary packages — a security-by-default change. Our toolchain needs three to actually function: `esbuild` (Vitest bundler), `sharp` (Next.js image optimization), `unrs-resolver` (ESLint module resolver).

**Decision.** Approve these three in `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  esbuild: true
  sharp: true
  unrs-resolver: true
```

These are the standard binary-fetch scripts for our stack and are widely used. We only allow scripts for packages we explicitly trust; new ones surface as install warnings (`ERR_PNPM_IGNORED_BUILDS`) and require an explicit add to the list.

**Alternatives considered.**
- `pnpm approve-builds` interactive command — does the same thing but interactive only; we want the config in version control.
- `--ignore-scripts` opt-out — would break Vitest and image optimization at runtime.

**Consequences.** New native-binary deps require an explicit allowlist update. Future agents adding such deps will see the install warning and should add the package here, not work around it.

---

## 0015 — Internal imports inside our own packages are extensionless
**Date:** 2026-05-21
**Status:** Accepted

**Context.** TypeScript ESM convention is `import './foo.js'` (the `.js` extension is what the emitted code will use at runtime under Node native ESM). However, Next.js's webpack-based bundler does not resolve `.js` imports back to `.ts` source files in workspace packages, even with `transpilePackages`. The result: `Module not found: Can't resolve './types/index.js'` errors during Next builds.

**Decision.** Inside `packages/core`, `scripts/ingest`, and any future workspace package: relative imports are **extensionless** (`import './foo'`, not `import './foo.js'`). `node_modules` imports are unaffected.

**Alternatives considered.**
- Add a Next.js webpack alias to strip `.js` from workspace imports — fragile, more config, hidden behavior.
- Build `packages/core` to `dist/` and consume the build instead of source — slower DX, defeats the point of `transpilePackages`.
- Switch the entire repo to CJS — large regression in tooling, no benefit.

**Consequences.** Vitest, `tsx`, and Next's bundler all resolve extensionless imports to `.ts` source files in workspace packages. The cost is that we couldn't run these files directly with Node native ESM without a TypeScript compile step — but we never do that (Vitest, tsx, and Next are our runtimes). Documented in [CLAUDE.md](../CLAUDE.md) §2 so it's not relearned.

---

## 0014 — pnpm as the package manager
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Needed to pick between npm, pnpm, and yarn for the monorepo.

**Decision.** pnpm 9.x, pinned via `packageManager` field in the root `package.json`.

**Alternatives considered.**
- **npm.** Ships with Node, workspaces work, but it allows phantom dependencies — code that imports an undeclared transitive dep works locally and breaks elsewhere. This is exactly the bug pattern we want to prevent from leaking into `packages/core`.
- **yarn.** Classic is unmaintained; berry has compatibility friction with some tools. No upside over pnpm.

**Consequences.** Strict dependency resolution acts as automated enforcement of the `packages/core` purity rule. Content-addressable store gives faster installs. One-time install required (`npm install -g pnpm`). Lockfile is `pnpm-lock.yaml`.

---

## 0013 — Verification strategy: property tests in core, two-tab Playwright smoke, solver-verified ingest
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Need to decide how we'll get to high confidence that the engine and multiplayer sync are correct. Unit tests alone won't catch the distributed-systems bugs.

**Decision.** Three layers of verification:
1. **Property-based tests** in `packages/core` using `fast-check` (or vitest's built-in). Generate random valid move sequences and assert invariants: no cell ever contains an invalid value; the board derived from a move log equals the board after applying each move in order; applying moves in any order consistent with `seq` produces the same final state.
2. **Two-tab Playwright smoke test** in CI. Opens two browser contexts in the same coop room, has both spam-input into the same cells, asserts state convergence. Runs on every PR.
3. **Solver-verified ingest.** Every puzzle entering the `puzzles` table is run through our Norvig-ported solver; any with zero or multiple solutions is rejected.

We also keep classic unit tests (~90% coverage target in core) and a small Playwright happy-path smoke (create room → both players join → play to completion).

**Alternatives considered.**
- Only unit tests. Insufficient for distributed-systems bugs (race conditions, reconnect).
- Manual two-browser testing as the smoke. Doesn't scale and breaks the moment a regression slips in between manual runs.
- CRDT-based sync (Yjs/Automerge) to make conflicts impossible by design. Overkill for an 81-cell grid; significantly harder to make server-authoritative for anti-cheat.

**Consequences.** Up-front investment in test infrastructure (~1–2 days). High confidence on V1 correctness. The two-tab Playwright test becomes our load-bearing regression catcher and must be kept green.

---

## 0012 — Sudoku engine from scratch in `packages/core`; solver lives in ingest only
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Could pull in `sudoku-core` (npm) or write our own. The engine is small enough that the tradeoff is "save a day vs. take a dependency on code we'd read line-by-line anyway."

**Decision.** Write our own sudoku engine in `packages/core` (~400 LoC: types, validators, conflict detection, move reducer, completion check). No external sudoku library at runtime. **The Norvig-ported solver lives in `scripts/ingest` (or similar), not in `packages/core`** — it's used once at dataset ingest time to verify each puzzle has a unique solution, and never ships to clients.

**Alternatives considered.**
- Use `sudoku-core` npm package. Saves ~1 day but adds maintenance dependency and unfamiliar code paths.
- Put solver in `packages/core` for runtime hints. **Rejected**: runtime features (hints, win check, auto-check) all use `puzzles.solution` from the dataset directly. No need to ship a solver to clients.

**Consequences.** `packages/core` is small (~400 LoC) and tightly scoped. Smaller attack surface, smaller bundle. Solver code lives in ingest-time scripts and can be slow/heavy without affecting runtime. Future V2 features that genuinely need a solver (custom puzzle generation, "smart hints" with deduction steps, custom difficulty rating) can adopt the same Norvig implementation from scripts.

---

## 0011 — Kaggle 9M Sudoku dataset as the V1 puzzle source
**Date:** 2026-05-21
**Status:** Superseded by #0018 — we ended up using the 3M variant (`radcliffe/3-million-sudoku-puzzles-with-ratings`) because it ships a numeric difficulty rating column. Original entry retained for context below.

**Context.** Need a puzzle source for V1. Building a generator is out of scope. The dataset needs to come with difficulty ratings and ideally pre-validated unique solutions.

**Decision.** Use the Kaggle "9 million Sudoku puzzles" dataset (or similar 1M variant if it's friendlier to download). CSV format: `puzzle,solution[,difficulty]` per row. Ingest 500–1000 medium-difficulty puzzles into the `puzzles` table for V1.

**Alternatives considered.**
- Build our own generator. Real time sink, out of V1 scope.
- Smaller curated GitHub puzzle packs. Often lack difficulty rating or are smaller than we want.
- HoDoKu-generated puzzles. Better difficulty rating but requires running HoDoKu (Java).

**Consequences.** One-time ingest script in `scripts/ingest/` reads the CSV, runs the Norvig solver to verify uniqueness (per [#0012](#0012)), and upserts into Supabase. Both `givens` and `solution` come from the dataset directly. Difficulty rating is whatever the dataset provides. If V2 wants more varied or self-generated puzzles, we replace the ingest source without changing the runtime engine.

---

## 0010 — Name: Sudoku Squad
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Used "Sudoku Squad" as a working title while writing the initial docs. Needed to confirm before registering a domain, branding the app, or submitting to the App Store.

**Decision.** "Sudoku Squad" is the real name.

**Alternatives considered.** None were actively proposed; the placeholder fit.

**Consequences.** Domain to register (sudokusquad.com is the natural first try). App Store listing, repo name, and copy throughout the app all use "Sudoku Squad." Visual identity and logo still TBD.

---

## 0009 — All game settings are per-room (host configures in lobby)
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Auto-check, hints, show-conflicts, and other gameplay settings could each be per-player private prefs or per-room settings set by the host. Per-player creates asymmetric advantages in battle and uneven coop experiences. Per-room is uniform but more paternalistic.

**Decision.** All game settings are per-room. The host picks them at the lobby; once the game starts, the settings panel is read-only. Single-player has its own settings (no other players to coordinate with).

**Alternatives considered.**
- Per-room for fairness-sensitive settings (auto-check, hints), per-player for purely cosmetic (highlight same number). Two UIs, fuzzy boundary.
- All per-player. Simpler to build but allows asymmetric play in battle and inconsistent coop experience.

**Consequences.** Lobby UI gains a settings panel that the host edits. After Start, the panel becomes read-only for everyone. A player who'd prefer different cosmetic settings has to ask the host. Single-player keeps a private in-game settings sheet.

---

## 0008 — Battle: losers can keep solving after a winner is declared
**Date:** 2026-05-21
**Status:** Accepted

**Context.** When one battle player finishes and wins, the others are partway through. Ending their game abruptly removes the satisfaction of finishing what they started.

**Decision.** When a winner is declared, every player sees an overlay announcing the winner. Losers can dismiss the overlay and continue solving their own board. The result is already final and recorded.

**Alternatives considered.**
- Game ends for everyone immediately. Cleaner UX, faster turn-around to play-again, but abrupt.
- Modal asking each loser: "finish anyway?" Most explicit, slightly more to build.

**Consequences.** Battle has two end states: "decided" (winner announced, others may still be solving) and "fully closed" (everyone has finished or quit). Play-again button shows immediately for the winner; for losers it appears after they finish or dismiss the continue option.

---

## 0007 — Coop notes: shared by default, with a private-notes mode (V1 stretch)
**Date:** 2026-05-21
**Status:** Accepted

**Context.** In coop, pencil marks could be shared across players (matches the collaborative spirit; matches solving on paper together) or private per player (parallel reasoning without stepping on each other's marks).

**Decision.** Default is shared/merged notes: toggling a note adds or removes the mark for everyone. We additionally support a per-player "private notes" mode — when on, that player's pencil marks are invisible to teammates and don't affect the shared set.

**Alternatives considered.**
- Shared only. Simplest. Doesn't accommodate "I'm reasoning through a chain; don't show my partner my noise."
- Private only. Loses the visible collaboration that makes coop feel coop.

**Consequences.** Notes data model has two streams per cell: a shared set (room-wide) and a private set (per player, client-only). UI gets a "Private notes" toggle near the number pad. Server broadcasts shared-notes changes; private notes never leave the client. **V1 stretch:** if this becomes a time sink, descope to shared-only and move the private toggle to V2. Flagged in `docs/TODO.md`.

---

## 0006 — Anonymous auth + per-room usernames
**Date:** 2026-05-21
**Status:** Accepted

**Context.** V1 needs to be frictionless — clicking a link should drop you straight into a game. Full account systems (email, OAuth) add steps and a privacy ask we don't need yet.

**Decision.** Supabase anonymous auth. Each device gets a stable anon user ID (cached in localStorage / AsyncStorage). Username is chosen per-room and stored on `room_players`.

**Alternatives considered.**
- Magic link / email accounts — more friction, more value once we have history/stats.
- OAuth (Apple/Google) — required for App Store eventually but not yet for web V1.
- Both anonymous + accounts — more to build; defer.

**Consequences.** No password reset flows, no profile pages, no friends list. We *do* need to handle the case where a user clears storage and loses their anon ID. Reconnection within a session is reliable; long-term identity is not. We commit to building proper accounts in V2.

---

## 0005 — Vercel + Supabase for hosting
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Need to host the web app and the backend cheaply and with minimal ops.

**Decision.** Vercel for `apps/web`, Supabase Cloud for Postgres/Realtime/Edge Functions.

**Alternatives considered.**
- Fly.io / Railway — more control, predictable pricing.
- AWS — overkill for V1.

**Consequences.** Generous free tiers should cover us through demo. Vendor lock-in is real but acceptable — both pieces are replaceable later (Postgres is portable, Next.js is portable). Edge Functions are the most lock-in-y piece; we keep them small.

---

## 0004 — Supabase for backend (Postgres + Realtime + Edge Functions)
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Multiplayer sudoku needs realtime sync + durable game state + some server-authoritative logic (for cheat prevention and completion checks).

**Decision.** Supabase. Postgres holds rooms/players/moves/puzzles. Realtime channels broadcast moves and presence. Edge Functions host server-authoritative validators.

**Alternatives considered.**
- Firebase — strong but expensive at scale and Google lock-in.
- Custom Node + WebSockets — most control, most ops work.
- Partykit / Cloudflare Durable Objects — purpose-built for rooms, but newer/less familiar. Strong "if Supabase doesn't pan out" candidate.

**Consequences.** First-class SDKs for both web and React Native. Postgres lets us reason about state durably. Realtime quota is the thing to watch — we throttle presence updates to ~10/s to avoid burning quota.

---

## 0003 — React Native + shared TypeScript core for cross-platform
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Cross-play between web and iOS is an explicit goal. Need to decide how the iOS app is built.

**Decision.** Web in Next.js. iOS (Phase 4) in React Native via Expo. A shared TS package `packages/core` contains all game logic, types, validators, and Supabase sync — both clients import it.

**Alternatives considered.**
- Native Swift — best iOS polish, but doubles client work and forces all game rules onto the server.
- Capacitor wrapper — fastest path but doesn't feel native; App Store review risk.
- Flutter — would require rewriting the web app in Dart; throws away the React/Supabase ecosystem.

**Consequences.** Lint rule needed on `packages/core` to ban DOM/Next/RN imports. UI is written twice (~600 LoC per platform) but logic is written once. Cross-play is effectively free because both clients run the same sync code. Need to budget an explicit iOS polish sprint for haptics, keyboard, and iOS-feel.

---

## 0002 — Lean V1 scope
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Could either ship a minimal demo fast or a polished v1 with many tiers/settings.

**Decision.** Lean V1: single difficulty tier, small puzzle pack, minimal settings, anonymous-only. Get to a playable multiplayer demo we can share with friends, then iterate.

**Alternatives considered.** Full-featured V1 (all tiers, accounts, leaderboards) — slower to first demo, harder to validate fun.

**Consequences.** [ROADMAP.md](ROADMAP.md) Phases 1–4 are scoped to "good enough to play and enjoy." Anything else is V2.

---

## 0001 — Web first, then iOS, no Android in V1
**Date:** 2026-05-21
**Status:** Accepted

**Context.** Need to pick a target order.

**Decision.** Single-player web → battle web → coop web → iOS. Android is out of scope for V1 and we don't commit to it in V2 either.

**Alternatives considered.** iOS-first (closes the door on quick iteration); web + Android first (no compelling reason); all three at once (too much).

**Consequences.** Web is the proving ground for both UX and protocol. iOS comes only after the protocol is stable, which is why `packages/core` is set up early.

---

# Open questions (live)

Resolved items get moved into the log above. These are still TBD. Items grouped by when they have to be decided.

## Decide before Phase 2 ships

1. **Username profanity filter** — not needed for friend-and-family beta. Defer; revisit when a public-launch ask is real.

## Decide during Phase 2/3

2. **Battle tiebreak when no one finishes within N minutes** — needed? Threshold? Leaning "no hard time limit in V1; people quit naturally."
3. **Host migration in coop** — automatic transfer to the longest-tenured remaining player, or require acknowledgement?
4. **Mobile cursor visualization in coop** — phones have no persistent cursor. Working assumption: ring persists on last-tapped cell, fades after ~3 s of inactivity. Validate during coop UI work.
5. **`board_snapshots` table** — add now for fast rejoin or wait until measurable problem? Leaning wait.

## Open longer-term

6. **Visual identity** — color palette, typography, logo, completion celebration style. Current interim is Tailwind stone-900 + amber-200 accents (sufficient for V1 demo, not committed to). Needs a design pass before any public-facing push.
7. **Expert tier sourcing** — the 3M Kaggle dataset has only ~100 puzzles rated > 7.0, not enough for a 2 500-row sample (per #0018). Find or generate a higher-difficulty source before re-enabling the tier.
8. **Vercel ↔ Supabase preview environment** — preview deploys currently hit the *production* Supabase project. Fine for V1; revisit before more users.

## Recently resolved (and where it landed)

- **Edge Function vs SQL RPC for multiplayer endpoints** — resolved in #0023 (TS Edge Functions across the board).
- **Mid-game join behavior** — resolved in #0024 (battle locks at Start, coop is open anytime, finished refuses).
- **Disconnect grace period** — resolved in #0025 (2 minutes).
- **Puzzle code format** — resolved in #0019 (6-char lowercase base36, deterministic from givens).
- **Room code format** — resolved in #0021 (6-char lowercase base36, random, retried on collision).
- **Cross-mode puzzle reference** — resolved in #0020 (`rooms.puzzle_code` FK to `puzzles.code`).
- **`rooms.mode` includes `single`** — resolved (dropped via migration 0004; single-player doesn't use rooms).
- **Solution exposure for SP vs. multiplayer** — resolved in #0022 (SP uses the `sp_get_puzzle` RPC; multiplayer uses Edge Functions that never expose `solution`).
- **Puzzle dataset variant** — resolved in #0018 (Kaggle 3M with the rating column; supersedes #0011).
