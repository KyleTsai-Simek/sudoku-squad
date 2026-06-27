# End-game share links + OG images plan

**Date:** 2026-06-27  
**Status:** Implemented locally; deploy + external unfurl validation remain.

## Goal

After a player finishes a puzzle, the end-game modal should let them share a link that:

- Lets another player try the exact same puzzle.
- Includes share text with the puzzle difficulty and the finisher's time.
- Unfurls with a fun, puzzle-specific Open Graph image that also shows the key result details.
- Is easy to preview locally and in production so we can iterate on copy and image design before relying on social unfurl caches.

This is a cross-cutting polish/product feature. It builds on existing single-player completion state, daily completion tracking, and the existing `/play/[code]` route. It does not change puzzle generation or multiplayer sync rules.

## Product scope

### First implementation

- Add a share action to all end-game modals: single-player `CompletionOverlay`, `BattleWinnerOverlay`, and `CoopWinOverlay`.
- The primary link target is a short public share URL: `/s/{token}`. The share page presents metadata for crawlers, then lets human visitors play the same puzzle via `/play/{puzzleCode}`.
- Use the Web Share API when available, with clipboard fallback.
- Suggested share text shape: "Try this Hard Sudoku Squad puzzle. I finished in 4:12."
- Dynamic OG image should use a playful board-card direction and include Sudoku Squad branding, difficulty label, solve time, and a visual treatment inspired by the solved board without exposing the solution in a useful way.
- Add a dev/test preview surface so we can inspect several sample share pages and OG image variants before relying on social unfurl caches.

### Follow-up candidates

- Add daily-specific copy: "June 27 Daily Hard" or "Today's Hard daily".
- Add a public gallery/debug route for curated preview cases.

## Architecture proposal

### Link model

Use a signed, stateless share URL for the first pass.

Encode `puzzleCode`, `difficulty`, `solveTimeMs`, `mode`, optional daily date, optional multiplayer room code, and a short HMAC signature in the URL token. The server verifies the signature before rendering the result metadata. This avoids a new table, keeps links durable, and prevents casual time editing. The signature secret lives only in web server env.

Defer a persisted `share_results` table unless we later need analytics, deletion/moderation, canonical result history, or shorter opaque slugs.

### Routes

- `apps/web/app/s/[token]/page.tsx`
  - Server-rendered page with `generateMetadata`.
  - Validates the token/signature or returns a safe generic "Try this Sudoku Squad puzzle" fallback.
  - Human page renders a compact challenge view and a clear "Play this puzzle" action to `/play/{puzzleCode}`.
- `apps/web/app/s/[token]/opengraph-image.tsx`
  - Uses Next.js `ImageResponse` for dynamic OG art.
  - Renders at `1200x630`.
  - Must not render the solution. If a grid appears, use givens only, abstract cells, or a non-reconstructable decorative board.
- Optional debug route:
  - `apps/web/app/share-preview/page.tsx` lists representative signed links and direct OG image links for Easy / Hard / Extreme, short / long times, and daily vs non-daily.

### Client integration

- Extract a small helper in `apps/web/lib/share-result.ts`:
  - `formatShareTime(ms)`.
  - `buildShareMessage({ difficulty, solveTimeMs, url, mode, daily })`.
  - `shareResult(payload)` that calls `navigator.share` when available and falls back to `navigator.clipboard.writeText`.
- Add a `Share` button in `CompletionOverlay` after the result summary and before navigation actions.
- Keep UI compact in the existing modal; no nested cards.
- Use an icon from the existing local Material Symbols set if available, or add a small share icon next to the action.

### Metadata and cache behavior

- Root metadata can stay generic, but share routes own their dynamic title, description, canonical URL, and Open Graph/Twitter metadata.
- Dynamic OG images should be cacheable. If using signed stateless links, set a long cache TTL because the rendered result is immutable.
- Provide a local verification path that does not depend on external social caches: open the share page, open the direct `opengraph-image` URL, and optionally run a lightweight dimension/render check.

## Data and privacy rules

- Shared result links are public by design. Do not include email, `auth.uid()`, usernames, or private account data.
- Do not include the puzzle solution in the URL, HTML, metadata, or OG image.
- Shares are anonymous for the first pass. Multiplayer share text can mention mode and player count, but not a player name.
- Daily metadata is safe to include only as date + difficulty + puzzle code; solve rows remain private.

## Testing plan

- Unit tests for time formatting, share-message formatting, and token/signature validation.
- Route-level tests for valid token, tampered token, and missing puzzle.
- Metadata tests or lightweight render checks for title/description/OG image URL.
- Playwright checks:
  - Single-player solve shows the Share button in the completion modal.
  - Clipboard fallback writes expected message + URL.
  - Share page "Play this puzzle" routes to `/play/{code}`.
  - Mobile width modal layout does not overflow.
- Manual QA:
  - Desktop and mobile completion modal.
  - Direct share links for multiple difficulties and times.
  - Direct OG images at `1200x630`.
  - External validators after deploy: Slack/iMessage/manual unfurl checks and a cache-busting strategy while iterating.

## Accepted decisions

1. Use signed stateless links.
2. Use short `/s/{token}` URLs.
3. Include single-player, daily, battle, and coop end-game modals in the first implementation.
4. Keep shares anonymous; do not include usernames.
5. Use softer "Try this puzzle" copy.
6. Use a playful board-card visual direction for OG images.

## Implementation slices

1. 🔄 Add token/message helpers and tests. Helpers are implemented and covered through the single-player Playwright share flow; focused token edge-case unit coverage remains pending.
2. ✅ Add `/s/[token]` route + metadata + "Play this puzzle" page.
3. ✅ Add dynamic OG image route and preview cases.
4. ✅ Wire single-player, battle, and coop completion modals.
5. 🔄 Verify desktop/mobile UI plus link/metadata/image previews. Local typecheck, build, targeted Playwright, `/share-preview`, and direct OG PNG checks are complete; deployed social-app unfurl testing remains.
