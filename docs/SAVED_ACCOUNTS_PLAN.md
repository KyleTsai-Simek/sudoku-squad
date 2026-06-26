# Saved Accounts Plan

**Status:** Phase 5 active. Backend + client scaffolding is landed; full saved-account verification and hardening are in progress.

This is the implementation and verification tracker for functional saved accounts. Keep it updated as each milestone lands. Summary state belongs in [STATUS.md](STATUS.md); granular task checkboxes live here and in [TODO.md](TODO.md).

---

## Product Shape

Sudoku Squad stays anonymous-first. A saved account is an optional upgrade, not a gate:

- First visit creates a Supabase anonymous user.
- Progress, rooms, moves, and usernames continue to key off `auth.uid()`.
- "Save account" links an email to the current anonymous identity when the email is new.
- Signing into an existing email account merges this device's anonymous progress into that saved account.
- Sign-out returns the device to a fresh anonymous identity.

No game routes become protected routes in this phase. A hard `/signin` redirect model is a poor fit for the current product because the app's core promise is a low-friction share link.

---

## External Reference Points

Supabase docs to keep handy:

- [Next.js server-side auth](https://supabase.com/docs/guides/auth/server-side/nextjs): use `@supabase/ssr` for cookie-aware server clients, middleware/proxy session refresh, and protected server routes.
- [Email OTP sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithotp): `signInWithOtp`, code verification, and magic-link redirects.
- [Anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous): anonymous users can be upgraded by linking an identity such as email.
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security): policies should derive user identity from `auth.uid()`, never from client-supplied IDs.

Project-specific decisions:

- [DECISIONS #0043](DECISIONS.md): anonymous-first email OTP accounts, cross-device progress merge, Discord-style renames.
- [ARCHITECTURE §4](ARCHITECTURE.md): `player_completions`, `issued_usernames`, `room_players`, and `moves` are already scoped by Supabase user IDs.

---

## Architecture

### Identity Model

| State | Supabase user | App behavior |
|---|---|---|
| Anonymous default | `auth.users` row with `is_anonymous = true` | Can play, join rooms, earn per-device progress, receive generated username. |
| New saved account | Same `auth.uid()` after email link | Existing progress and username remain automatically. Rename becomes available. |
| Existing saved account | Different `auth.uid()` from this device's anon user | `merge-progress` unions abandoned anonymous completions into the account. |
| Signed out | Fresh anonymous user | Account progress remains under the saved account and returns on next sign-in. |

### Client Components

- `apps/web/lib/supabase.ts`
  - Browser Supabase client using the public anon key.
  - Anonymous session persistence in localStorage.
  - PKCE + manual callback handling for magic links.
- `apps/web/lib/auth-store.ts`
  - Owns account state, email OTP start/verify, magic-link completion, merge-progress call, and sign-out-to-anon.
- `apps/web/app/auth/callback/page.tsx`
  - Exchanges PKCE `code` or verifies `token_hash/type`, then returns home.
- `apps/web/components/auth-sheet.tsx`
  - Email + OTP UI.
- `apps/web/components/username-sheet.tsx`
  - Signed-in rename UI.
- `apps/web/components/app-header.tsx`
  - Account entry on every screen.

### Backend

- Migrations:
  - `0018_mutable_usernames.sql`
  - `0019_completion_stats.sql`
- Edge Functions:
  - `claim-username`
  - `set-username`
  - `merge-progress`
- Existing RPCs:
  - `record_completion`
  - `get_completion_count`
  - `get_completion_stats`

### SSR Decision

Do not add `@supabase/ssr` solely for the current account menu. The current app can stay browser-client-first because game pages intentionally remain public/anonymous-capable.

Add `@supabase/ssr` later only if we introduce protected server-rendered account pages, profile pages, billing, admin surfaces, or server actions that require reading the session from cookies.

---

## Security Rules

- The anon key is public and safe in web/native clients.
- The service-role key stays server-only: Edge Functions, scripts, and CI secrets only.
- Never trust a `user_id` or `player_id` from the client body.
- Edge Functions derive caller identity from the Authorization JWT.
- `merge-progress` requires both identities:
  - destination account from the Authorization header
  - source anonymous user from `source_token`
- `merge-progress` refuses:
  - missing/invalid source token
  - anonymous destination
  - permanent-account source
  - source = destination, except as a no-op
- Any future user-owned table must:
  - include `user_id uuid references auth.users(id)` or use the existing `player_id`
  - enable RLS
  - use policies equivalent to `auth.uid() = user_id`
  - index the user-scoped column when policies query it frequently

---

## Milestones And Tracker

### M0 — Plan Captured

- [x] Add this plan document.
- [x] Link the plan from `STATUS.md`, `ROADMAP.md`, and `TODO.md`.
- [x] Commit and push the documentation milestone before code changes.

### M1 — Live Config And Baseline Audit

- [ ] Confirm Supabase dashboard settings:
  - [ ] Email provider enabled.
  - [ ] OTP length is 6 digits unless the product decision changes.
  - [ ] Email template references Sudoku Squad and includes both `{{ .ConfirmationURL }}` and `{{ .Token }}`.
  - [ ] Redirect allow-list includes local, Vercel preview, and production `/auth/callback`.
  - [ ] Rate limits are acceptable for manual testing.
- [ ] Confirm `0018` and `0019` are live.
- [ ] Confirm deployed functions match repo code:
  - [ ] `claim-username`
  - [ ] `set-username`
  - [ ] `merge-progress`
- [ ] Record any Supabase CLI/dashboard access gaps in `STATUS.md`.

### M2 — Automated Backend Verification

- [x] Add an account verification script under `scripts/ingest` (`pnpm --filter @sudoku-squad/ingest verify:accounts`).
- [ ] Verify schema:
  - [x] `issued_usernames.base`
  - [x] `issued_usernames.discriminator`
  - [x] generated `issued_usernames.username`
  - [x] `get_completion_stats()`
- [ ] Verify anonymous behavior:
  - [x] fresh anonymous sign-in works
  - [x] `claim-username` issues a name
  - [x] `set-username` rejects anonymous callers
- [ ] Verify signed-in behavior without relying on a human inbox if feasible:
  - [ ] create or obtain a test saved account session
  - [ ] rename to a free base
  - [ ] collision assigns discriminator
  - [ ] changing away frees the old tuple
  - [ ] `merge-progress` unions completions
  - [ ] `merge-progress` rejects invalid/permanent-source tokens
- [ ] If full automation is blocked by email/session constraints, document the exact manual step and keep partial automation.

### M3 — Client Flow Hardening

- [ ] Make auth errors user-actionable.
- [ ] Ensure pending magic-link state survives reload.
- [x] Ensure merge failure is visible/retryable instead of silently swallowed.
- [ ] Ensure username and solved-count refresh after:
  - [ ] new-email link
  - [~] existing-account sign-in
  - [ ] rename
  - [ ] sign-out
- [ ] Ensure anonymous-only play still works when Supabase email config is unavailable.
- [ ] Remove any misleading "signed out" copy: users are always anonymous or saved-account, not unauthenticated.

### M4 — Playwright E2E

- [ ] Add local-only account specs.
- [ ] Test new-email link path:
  - [ ] start as anon
  - [ ] complete one puzzle or seed one completion
  - [ ] save account with email
  - [ ] verify same `auth.uid()` or preserved solved count
- [ ] Test existing-account merge path:
  - [ ] browser A saved account has completion A
  - [ ] browser B anonymous user has completion B
  - [ ] browser B signs into same email
  - [ ] account count is union A+B
- [ ] Test rename:
  - [ ] free base gives bare name
  - [ ] taken base gives `#NNNN`
  - [ ] changing away frees old tuple
- [ ] Test sign-out:
  - [ ] new anonymous identity appears
  - [ ] signing back in restores saved-account progress

### M5 — Manual Product Checkpoint

Ask the user to manually test on production or preview:

- [ ] Save account from a fresh anonymous session.
- [ ] Click the magic link in email and land back in the app.
- [ ] Enter the OTP code instead of using the link.
- [ ] Rename account.
- [ ] Sign out and confirm a fresh anonymous username appears.
- [ ] Sign back in and confirm progress returns.
- [ ] Try the same account on a second browser/device and confirm progress union.

### M6 — Release Completion

- [ ] Run full local verification:
  - [ ] `pnpm --filter @sudoku-squad/core test`
  - [ ] `pnpm --filter @sudoku-squad/ingest test`
  - [ ] `pnpm --filter @sudoku-squad/ingest verify:samples`
  - [ ] `pnpm --filter @sudoku-squad/ingest check`
  - [ ] `pnpm -r typecheck`
  - [ ] `pnpm --filter @sudoku-squad/web build`
  - [ ] `pnpm --filter @sudoku-squad/web test:e2e`
- [ ] Update `STATUS.md`, `TODO.md`, `ROADMAP.md`, and this document.
- [ ] Commit and push implementation milestone.
- [ ] Confirm Vercel deploy.
- [ ] Run production smoke.

---

## Supabase Console Steps For The User

I can verify some live behavior with the configured anon/service-role keys, but I cannot reliably operate Supabase dashboard settings from here. User-owned steps:

1. Open Supabase Dashboard → Authentication → Providers → Email.
2. Confirm Email provider is enabled.
3. Confirm OTP length is 6 digits unless we deliberately switch the app copy and docs to 8.
4. Confirm Site URL is the production app URL.
5. Add redirect allow-list entries for:
   - `http://localhost:3000/auth/callback`
   - `http://localhost:3100/auth/callback`
   - Vercel preview callback pattern or exact preview URL
   - `https://sudoku-squad-web.vercel.app/auth/callback`
6. Update the email template to Sudoku Squad branding. It should include both the magic-link button and the token code.
7. Tell Codex what test email address(es) to use for manual and automated account tests, if any.

---

## Manual Test Checkpoints

Ask for manual validation at these points:

1. **After M1/M2:** user confirms Supabase email arrives and callback URL is accepted.
2. **After M3:** user confirms account menu, code entry, sign-out, and rename feel right.
3. **After M4:** user confirms cross-device merge with two real browsers/devices.
4. **Before M6 push to live:** user gives go/no-go if tests require production email behavior.

---

## Open Questions

- Should the email template use 6-digit OTP copy permanently, or do we want to switch to 8 digits for brand/security feel?
- Do we want a visible stats/account screen in this phase, or keep stats backend-only as in [DECISIONS #0043](DECISIONS.md)?
- Should merge failures create a visible "retry merge" action, or is a toast/error log acceptable for V1?
- Do we want account e2e to use a real inbox provider, Supabase admin-generated links, or remain a scripted/manual hybrid?
