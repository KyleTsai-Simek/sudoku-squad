# End-game share links + OG images plan

**Date:** 2026-06-29  
**Status:** Implemented locally; external unfurl validation remains.

## Goal

After a player finishes a puzzle, the end-game modal should let them share a link that:

- Lets another player try the exact same puzzle.
- Includes share text with the puzzle difficulty and the finisher's time.
- Unfurls with a fun, puzzle-specific Open Graph image that also shows the key result details.
- Is easy to preview locally and in production so we can iterate on copy and image design before relying on social unfurl caches.

This is a cross-cutting polish/product feature. It builds on existing single-player completion state, daily completion tracking, and the existing `/play/[code]` route. It does not change puzzle generation or multiplayer sync rules.

## Product scope

- Add a share action to all end-game modals: single-player `CompletionOverlay`, `BattleWinnerOverlay`, and `CoopWinOverlay`.
- Use short public share URLs: `/s/{puzzleCode}/{time}`, where `time` is elapsed seconds in base36. Daily links include `?d=YYYY-MM-DD`.
- Use the Web Share API when available, with clipboard fallback.
- Share text shape: "Try this hard puzzle. I finished in 4:12!"
- Dynamic OG image should use a playful board-card direction with black Sudoku Squad branding, puzzle info (`Medium 3santv`), a visually-separated finished-time badge, a bottom primary-style "Try this puzzle" button, and a board visual that does not expose the solution in a useful way.
- The OG renderer looks for a supplied logo asset at `apps/web/public/brand/sudoku-squad-logo.png` first, then `apps/web/public/brand/sudoku-squad-logo.svg`. Prefer a transparent PNG for predictable social-image rendering. The route sets the rendered logo size in code instead of relying on the asset's intrinsic dimensions; until an asset exists, it falls back to the text title.
- The share landing page should not flag solo, co-op, or battle. Its category is either "EASY PUZZLE" or "JUNE 29 DAILY EASY PUZZLE"; its description is "Easy puzzle finished in 5:51."
- Daily share entry must behave like the home Daily Puzzles row: the "Play this puzzle" link preserves `daily` and `dailyDifficulty` query params so completion records daily progress and shows the daily completion modal.
- `/share-preview` should list representative share links and direct OG image links so links can be tested without beating a puzzle.

## Architecture

### Link model

Use a short conventional URL instead of a signed token:

- `/s/{puzzleCode}/{time}` for normal shares.
- `/s/{puzzleCode}/{time}?d=YYYY-MM-DD` for daily shares.

`time` is elapsed seconds encoded in base36. The share route loads puzzle difficulty/givens from the public puzzle projection. Links are intentionally non-unique and editable; they are invitations, not verified score records. Defer a persisted `share_results` table unless we later need analytics, deletion/moderation, canonical result history, or opaque slugs.

### Routes

- `apps/web/app/s/[code]/[time]/page.tsx`
  - Server-rendered page with `generateMetadata`.
  - Validates the code/time convention or returns a safe generic "Try this Sudoku Squad puzzle" fallback.
  - Human page renders a compact challenge view and a clear "Play this puzzle" action to `/play/{puzzleCode}` or the daily-preserving play URL.
- `apps/web/app/s/[code]/[time]/opengraph-image.tsx`
  - Uses Next.js `ImageResponse` for dynamic OG art.
  - Renders at `1200x630`.
  - Must not render the solution. If a grid appears, use givens only, abstract cells, or a non-reconstructable decorative board.
- `apps/web/app/share-preview/page.tsx`
  - Lists representative short links and direct OG image links for Easy / Hard / Expert, short / long times, and daily vs non-daily.

### Client integration

- Share helpers in `apps/web/lib/share-copy.ts` and `apps/web/lib/share-url.ts`:
  - `formatShareTime(ms)`.
  - `buildShareMessage({ difficulty, solveTimeMs })`.
  - `buildShareUrl({ puzzleCode, solveTimeMs, dailyDate })`.
- `ShareResultButton` builds the URL client-side. Native share uses `navigator.share({ title, text, url })` where `text` does not include the URL; clipboard fallback writes `text + "\n" + url`.
- Keep UI compact in existing modals; no nested cards.
- Use the iOS-style share icon for the Share button.
- In the daily completion modal, render the Daily Puzzles header + row first, then place Share next to Back to menu below that row.

## Data and privacy rules

- Shared result links are public by design. Do not include email, `auth.uid()`, usernames, or private account data.
- Do not include the puzzle solution in the URL, HTML, metadata, or OG image.
- Shares are anonymous for the first pass. Multiplayer share text does not mention mode or player count.
- Daily metadata is safe to include only as date + difficulty + puzzle code; solve rows remain private.

## Testing plan

- Helper coverage or focused route checks for time formatting, share-message formatting, base36 time encoding/decoding, and URL creation.
- Route-level checks for valid short links, invalid time/code, daily links, and missing puzzle.
- Metadata checks or lightweight render checks for title/description/OG image URL.
- Playwright checks:
  - Single-player solve shows the Share button in the completion modal.
  - Clipboard fallback writes expected message + URL.
  - Native share text does not include a duplicate URL.
  - Share page "Play this puzzle" routes to `/play/{code}`.
  - Daily share page routes to `/play/{code}?daily=YYYY-MM-DD&dailyDifficulty=easy`.
  - Mobile width modal layout does not overflow.
- Manual QA:
  - Desktop and mobile completion modal.
  - Direct share links for multiple difficulties and times.
  - Direct OG images at `1200x630`.
  - External validators after deploy: Slack/iMessage/manual unfurl checks and a cache-busting strategy while iterating.

## Accepted decisions

1. Superseded by [DECISIONS #0052](DECISIONS.md): use short conventional `/s/{puzzleCode}/{time}` links for new shares.
2. Use short `/s/{puzzleCode}/{time}` URLs.
3. Include single-player, daily, battle, and coop end-game modals.
4. Keep shares anonymous; do not include usernames.
5. Use "Try this puzzle" copy.
6. Use a playful board-card visual direction for OG images.

## Implementation slices

1. ✅ Replace token helpers with short URL helpers and update share copy.
2. ✅ Add `/s/[code]/[time]` route + metadata + daily-preserving "Play this puzzle" page.
3. ✅ Refresh dynamic OG image route and preview cases.
4. ✅ Reposition daily-modal share action and switch to the iOS share icon.
5. 🔄 Verify deployed social-app unfurls after Vercel deploy. Local typecheck, production build, single-player Playwright share smoke, `/share-preview`, share page, daily share page, and direct OG PNG checks are complete.
