# Theme Refresh + Dark Mode

**Last updated:** 2026-06-26. **Status:** Complete.

The web app now uses a semantic theme system instead of direct Tailwind palette colors. Durable design/architecture details live in [ARCHITECTURE.md §1.1](ARCHITECTURE.md), [DECISIONS #0044](DECISIONS.md), and [DECISIONS #0045](DECISIONS.md).

## What Shipped

- High-contrast blue primary palette.
- Light and dark modes backed by CSS custom properties.
- Local account-menu appearance preference: `auto`, `light`, or `dark`.
- `auto` follows the user's native `prefers-color-scheme` setting.
- Notes mode keeps a warm amber accent.
- Player identity colors use light/dark player tokens while preserving the server-stored color slots.
- Home, lobby, game screens, boards, number pads, overlays, sheets, progress bars, loading states, and error states use semantic theme colors.

## Verification

- `pnpm --filter @sudoku-squad/web typecheck`
- `pnpm --filter @sudoku-squad/web lint` (passes with the known `lobby-client.tsx` hook warning)
- `pnpm --filter @sudoku-squad/web build`
- `pnpm --filter @sudoku-squad/web test:e2e` (5 / 5 locally)
- Desktop and mobile browser checks for light/dark mode, reload persistence, board contrast, account menu, notes amber, and player-color contrast.
