# CLAUDE.md — Agent instructions

This file is read by Claude (and other AI coding agents) at the start of every session. It encodes how to work in this repo so the docs stay accurate and the codebase stays coherent.

If you're a human reading this: this is *also* a good orientation doc.

---

## 0. Always start by reading the docs

Before doing anything non-trivial in this repo, read **in this order**:

1. [docs/STATUS.md](docs/STATUS.md) — **always read first.** Current state, what's built, what's verified, what's next, known gotchas.
2. [docs/GOALS_AND_SCOPE.md](docs/GOALS_AND_SCOPE.md) — what we're building and what we're not.
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the tech stack and data model.
4. [docs/ROADMAP.md](docs/ROADMAP.md) — what phase we're in.
5. [docs/TODO.md](docs/TODO.md) — what's next on the list.
6. [docs/DECISIONS.md](docs/DECISIONS.md) — what's already been decided and what's still open.
7. [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) — game modes, settings, UX choices.

These are the source of truth. If something in the code contradicts the docs, fix the docs (because they're wrong) or fix the code (because it drifted). Don't silently let them diverge.

### Quickstart for a new agent

If you've just landed in this repo:

```bash
# 1. Verify environment
pnpm install                                         # idempotent
pnpm --filter @sudoku-squad/core test                # expect 65/65
pnpm --filter @sudoku-squad/ingest test              # expect 9/9

# 2. Verify Supabase connection (requires .env.local at repo root +
#    apps/web/.env.local -> ../../.env.local symlink so Next.js can read it)
pnpm --filter @sudoku-squad/ingest check             # expect 4 green checks

# 3. Boot the app
pnpm dev                                             # http://localhost:3000

# 4. Read docs/STATUS.md and docs/TODO.md to see what to work on
```

If any of (1–3) fail, fix before adding features. See [docs/STATUS.md](docs/STATUS.md) gotchas for the `.env.local` symlink trick.

---

## 1. The doc-update protocol

**Whenever you make a meaningful change, update the docs in the same response.**

| If you... | Update... |
|---|---|
| Land a phase milestone, or the state of the project meaningfully shifts | `docs/STATUS.md` — refresh the "what's built / what's next / gotchas" sections, bump the date |
| Make a non-trivial design or stack choice | `docs/DECISIONS.md` — add a new entry at the top with the next number |
| Complete or add a task | `docs/TODO.md` — check it off or add it under the right phase |
| Change anything about how data flows or the data model | `docs/ARCHITECTURE.md` |
| Change game rules, settings, modes, or UX | `docs/GAME_DESIGN.md` |
| Change phase scope or order | `docs/ROADMAP.md` |
| Add a new dependency or change build setup | `README.md` and possibly `ARCHITECTURE.md` |

Stale docs are worse than no docs. Treat doc updates as part of the change, not as a follow-up.

---

## 2. Architectural rules (non-negotiable)

These rules exist to make Phase 4 (iOS port) painless. Breaking them in Phase 1–3 will cause real pain later.

### `packages/core` is platform-agnostic
- ✅ Allowed imports: `react` (for hooks only — no JSX components), `@supabase/supabase-js`, pure TS libraries (`zod`, `nanoid`, etc.).
- ❌ Forbidden: `next/*`, `react-dom/*`, `react-native/*`, `expo/*`, `window`, `document`, `localStorage`, `navigator`, anything DOM-specific or RN-specific.
- If `packages/core` needs a platform capability (storage, deep links, haptics), accept it as an injected dependency:
  ```ts
  interface PlatformCapabilities {
    kv: KvStore;
    haptic?: (kind: 'tap'|'success') => void;
  }
  ```
  Web and iOS each provide their own implementation.

### Server is authoritative for game-determining state
- Win/loss, completion, and any "is this cell right" check happens server-side. The puzzle's `solution` field **never** ships to the client during play.
- This isn't optional. Without it, anyone can DevTools their way to "I won."

### Optimistic UI with reconciliation
- Apply your own moves locally immediately.
- Send to server, get echo back with assigned `seq`.
- If server rejects (very rare), roll back. Don't queue rollbacks or silently drop.

### One Realtime channel per room
- Naming: `room:{room_id}`.
- Three payload kinds: `move`, `presence`, `game_event`. Don't proliferate.

### Internal imports in `packages/core` and `scripts/ingest` are extensionless
- Use `import ... from './foo'`, not `from './foo.js'`.
- Reason: Next.js's bundler doesn't resolve `.js` imports to `.ts` source files in workspace packages, even with `transpilePackages`. Vitest and `tsx` tolerate either; extensionless works everywhere we run TS source.
- This applies to relative imports inside our own packages only. `node_modules` imports are unaffected.

---

## 3. Code style

- **TypeScript** everywhere. No `any` without a `// eslint-disable-next-line` and a comment explaining why.
- **Prefer pure functions** in `packages/core`. State mutation lives in reducers; everything else is pure.
- **Naming:** descriptive over short. `applyMove`, not `apply`. `RoomCode`, not `RC`.
- **Files:** kebab-case for filenames, PascalCase for components.
- **Tests:** colocate (`foo.ts` + `foo.test.ts`). Use Vitest in `packages/core`, Playwright for `apps/web` smoke tests.
- **Comments:** explain *why*, not *what*. The code says what.
- **Don't add code comments unless they add real signal.** No `// constructor` over a constructor.

---

## 4. When in doubt, ask

If the user's request is ambiguous, use the `AskUserQuestion` tool *before* writing code. Architectural and UX decisions belong to the user. Implementation details are yours.

Things that are clearly user decisions (don't guess):
- Visual style, color palette, brand-feel choices.
- Whether to add a feature not in `GOALS_AND_SCOPE.md` / `TODO.md`.
- Anything from the "Open questions" list in `DECISIONS.md`.

Things that are clearly your call (just do it):
- File and folder naming inside an existing area.
- Library version choices that match what's already in use.
- Internal function signatures.
- Refactors that don't change behavior.

---

## 5. Verification expectations

Our verification strategy is laid out in [DECISIONS.md #0013](docs/DECISIONS.md): property-based tests in core, a two-tab Playwright smoke for sync, and solver-verified dataset ingest. Before claiming a task is done:

- **`packages/core` changes:** run the relevant Vitest tests; add new unit tests and, for anything stateful, **property-based tests** with `fast-check`. Coverage target ~90% in core. Property tests should assert invariants like "no cell ever holds an invalid value" and "any seq-consistent ordering of moves produces the same final state."
- **`apps/web` UI changes:** at minimum, manually verify on both desktop and mobile widths. Smoke-test the affected flow.
- **Schema changes:** the SQL migration must apply cleanly to a fresh DB. Run it locally against a scratch Supabase instance.
- **Sync changes:** the two-tab Playwright smoke must pass. The test is load-bearing — keep it green or fix what you broke. The smoke is "two clients hammering the same cell and the same room over multiple seconds; final state agrees."
- **Solver / ingest changes:** every puzzle entering the `puzzles` table must be solver-verified for unique solution. Solver code lives in `scripts/ingest/`, never in `packages/core`.

For higher-stakes work, use a sub-agent for an independent verification pass.

---

## 6. Git workflow

- Branches named like `feat/phase2-lobby-ui`, `fix/sync-rollback`, `chore/upgrade-next`.
- Commits in present tense (`add room lobby`, not `added`).
- PR description must reference the relevant TODO item and update the doc in the same PR.
- Never commit secrets. `.env*` files are gitignored.

---

## 7. Don't do (without explicit user OK)

- Don't introduce new top-level dependencies (frameworks, ORMs, state libraries) without checking — the stack is already chosen.
- Don't add an additional realtime layer "for performance" without measurement.
- Don't optimize prematurely; correctness first.
- Don't write features that aren't in the current phase's scope.
- Don't add monetization, analytics, or third-party scripts.
- Don't add emoji or marketing-style copy unless asked.

---

## 8. Tone and output

- Be direct. The user is technical and wants signal over reassurance.
- When you finish work, summarize what changed in plain prose. Skip "I successfully…" preambles.
- If something is broken or didn't work, say so clearly. Don't claim completion when something is incomplete.
- Don't bullet-point everything. Use prose for explanations; bullets for genuine lists.
