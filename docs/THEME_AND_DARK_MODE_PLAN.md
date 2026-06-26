# Theme Refresh + Dark Mode Plan

**Last updated:** 2026-06-26. **Status:** Implemented and verified in web; player identity colors are now theme-aware; user acceptance pending.

Goal: refresh the web app around a user-friendly, high-contrast blue primary color, extend it into a complete semantic palette, migrate the full UI to that scheme, and add light/dark mode support with a local `auto` / `light` / `dark` preference.

## Current audit

- The app currently uses direct Tailwind utility colors throughout `apps/web`: mostly `stone`, `amber`, `emerald`, `red`, plus a few direct `blue` and `orange` values.
- `apps/web/tailwind.config.ts` only extends fonts; there are no semantic color tokens yet.
- `apps/web/app/globals.css` only imports Tailwind layers; there are no CSS custom properties or dark-mode variables.
- `apps/web/app/layout.tsx` sets a fixed light `bg-stone-50 text-stone-900` body.
- Board components (`SudokuBoard`, `BattleBoard`, `CoopBoard`) intentionally choose one exact `bg-*` and `text-*` class per state to avoid Tailwind precedence bugs. The theme pass should preserve that lookup-style approach.
- The settings/account surfaces already have a shared entry point through `AppHeader`; this is the right place to expose a theme preference control.

## Working plan

1. **Choose the palette contract.**
   - ✅ Use an accessible default blue centered on `#1d4ed8` / `#2563eb`, with semantic support colors for background, surface, text, border, selected cell, related cells, success/completed, warning/notes, danger/conflict, and multiplayer player colors.
   - ✅ Keep player identity colors distinct from the UI primary color so coop/battle ownership still reads clearly.
   - ✅ Map the original eight stored player hex values to dedicated light/dark `--player-color-*` tokens instead of using raw inline colors in multiplayer UI.

2. **Add theme infrastructure.**
   - ✅ Add Tailwind `darkMode: 'class'`.
   - ✅ Add CSS custom properties in `globals.css` for light and dark themes.
   - ✅ Extend Tailwind colors with semantic token names instead of continuing to spread raw palette classes.
   - ✅ Add a small client theme store/provider for `auto` / `light` / `dark`, persisted in `localStorage`, with `auto` following `prefers-color-scheme`.

3. **Expose the setting.**
   - ✅ Add a compact theme selector in the account menu using `Auto`, `Light`, and `Dark`.
   - ✅ Apply the selected mode immediately without a page reload.
   - ✅ Keep the preference local-only; no database or account schema change.

4. **Migrate the UI.**
   - ✅ Replace hard-coded neutral/action colors across home, lobby, game screens, sheets, overlays, buttons, inputs, progress bars, and loading/error states with semantic tokens.
   - ✅ Replace raw player-color usage in lobby dots, battle progress, battle winner text, coop names, and coop progress segments with the player-token helper.
   - ✅ Update the three board components together so single-player, battle, and coop remain visually consistent.
   - ✅ Preserve existing layout behavior and the integer-pixel board sizing.

5. **Verify accessibility and behavior.**
   - ✅ Run lint/typecheck/build plus affected Playwright smokes.
   - ✅ Manually verify desktop and mobile widths in both light and dark modes.
   - ✅ Check board-state contrast, modal/account-menu overlays, notes-mode amber, and theme persistence across reloads.
   - ✅ Check player identity token contrast in light and dark mode; all eight player text colors are at least 5.18:1 on light surfaces and 6.56:1 on the dark game surface.

6. **Manual acceptance.**
   - 🔲 The final project step is user manual confirmation that the refreshed palette, light/dark behavior, and settings override all feel correct.

## Verification

- `pnpm --filter @sudoku-squad/web typecheck`
- `pnpm --filter @sudoku-squad/web lint` (passes with the pre-existing `react-hooks/exhaustive-deps` warning in `lobby-client.tsx`)
- `pnpm --filter @sudoku-squad/web build` (passes with the same warning)
- `pnpm --filter @sudoku-squad/web test:e2e` (5 / 5)
- Browser check: desktop + 375 px mobile, home + `/play/3santv`, account-menu Light/Dark toggle, theme persistence across reload, board/number-pad fit, and active notes-mode amber. `auto` is implemented via `prefers-color-scheme`; final user acceptance should include a native system-setting check.
- Player-color sweep: stored server colors now route through `apps/web/lib/player-colors.ts`; the only remaining hard-coded player hexes in web are the mapping table for the server-stored identifiers.

## Resolved implementation questions

1. Primary blue: implementation-picked accessible default.
2. Theme selector placement: account menu.
3. Notes mode accent: keep warm amber.
