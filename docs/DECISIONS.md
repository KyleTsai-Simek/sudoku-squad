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
**Status:** Accepted

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

Resolved items get moved into the log above. These are still TBD:

1. **Battle tiebreak when no one finishes within N minutes** — needed? If yes, what's the threshold? Currently leaning "no hard time limit in V1; people quit naturally."
2. **Host migration in coop** — automatic to longest-tenured remaining player, or require acknowledgement?
3. **Edge Function vs. SQL RPC** for `submit_move` — TS flexibility vs. simpler stack. Leaning Edge Function.
4. **`board_snapshots` table** — add now for fast rejoin or wait until measurable problem? Leaning wait.
5. **Mid-game join behavior** — battle locked after start vs. coop open anytime is the working assumption. Confirm before Phase 2 ships.
6. **Mobile cursor visualization in coop** — phones have no persistent cursor; needs a small spec. Working assumption: ring persists on last-tapped cell, fades after ~3s of inactivity.
7. **Share-link code format** — 6-char readable codes (no 0/O/1/I) vs. UUID. Leaning readable codes, recycled when room ends.
8. **Disconnect grace period** — 60s in architecture; may be too tight for mobile. Leaning 2 minutes.
9. **Username profanity filter** — not needed for friend-and-family beta; needed before public launch.
10. **Visual identity** — color palette, typography, logo, completion celebration style. Need design pass before any public-facing deploy.
