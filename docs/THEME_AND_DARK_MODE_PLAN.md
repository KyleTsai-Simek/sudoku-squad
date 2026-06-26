# Theme Refresh + Dark Mode Plan

**Last updated:** 2026-06-26. **Status:** Planning complete; implementation pending.

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
   - Define a high-contrast blue primary scale and supporting semantic colors for background, surface, text, border, selected cell, related cells, success/completed, warning/notes, danger/conflict, focus rings, and multiplayer player colors.
   - Keep player identity colors distinct from the UI primary color so coop/battle ownership still reads clearly.

2. **Add theme infrastructure.**
   - Add Tailwind `darkMode: 'class'`.
   - Add CSS custom properties in `globals.css` for light and dark themes.
   - Extend Tailwind colors with semantic token names instead of continuing to spread raw palette classes.
   - Add a small client theme store/provider for `auto` / `light` / `dark`, persisted in `localStorage`, with `auto` following `prefers-color-scheme`.

3. **Expose the setting.**
   - Add a compact theme selector in the settings/account menu using `Auto`, `Light`, and `Dark`.
   - Apply the selected mode immediately without a page reload.
   - Keep the preference local-only; no database or account schema change.

4. **Migrate the UI.**
   - Replace hard-coded neutral/action colors across home, lobby, game screens, sheets, overlays, buttons, inputs, progress bars, and loading/error states with semantic tokens.
   - Update the three board components together so single-player, battle, and coop remain visually consistent.
   - Preserve existing layout behavior and the integer-pixel board sizing.

5. **Verify accessibility and behavior.**
   - Run lint/typecheck/build plus affected Playwright smokes.
   - Manually verify desktop and mobile widths in both light and dark modes.
   - Check keyboard focus, board-state contrast, conflict/readiness states, modal overlays, and theme persistence across reloads.

6. **Manual acceptance.**
   - The final project step is user manual confirmation that the refreshed palette, light/dark behavior, and settings override all feel correct.

## Open questions for implementation

1. Should the primary blue be a specific brand value, or should implementation pick an accessible default blue?
2. Should the theme selector live inside the account menu, the game settings sheet, or both?
3. Should the current amber notes-mode accent stay warm, or should notes mode move into the new blue-led palette?
