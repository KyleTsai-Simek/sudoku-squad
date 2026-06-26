import type { CSSProperties } from 'react';

type PlayerColorSlot =
  | 'amber'
  | 'sky'
  | 'emerald'
  | 'rose'
  | 'violet'
  | 'orange'
  | 'teal'
  | 'fuchsia';

type PlayerColorCssProperty = 'backgroundColor' | 'borderColor' | 'color';

const STORED_COLOR_TO_SLOT: Record<string, PlayerColorSlot> = {
  '#f59e0b': 'amber',
  '#0ea5e9': 'sky',
  '#10b981': 'emerald',
  '#f43f5e': 'rose',
  '#8b5cf6': 'violet',
  '#ea580c': 'orange',
  '#14b8a6': 'teal',
  '#d946ef': 'fuchsia',
};

function playerColorSlot(storedColor: string | null | undefined): PlayerColorSlot {
  const normalized = storedColor?.trim().toLowerCase();
  return (normalized && STORED_COLOR_TO_SLOT[normalized]) || 'sky';
}

export function playerColorVar(storedColor: string | null | undefined): string {
  return `rgb(var(--player-color-${playerColorSlot(storedColor)}))`;
}

export function playerColorStyle(
  storedColor: string | null | undefined,
  property: PlayerColorCssProperty,
): CSSProperties {
  return {
    [property]: playerColorVar(storedColor),
  } as CSSProperties;
}
