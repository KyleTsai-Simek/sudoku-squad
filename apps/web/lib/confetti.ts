'use client';

import confetti from 'canvas-confetti';

const CONFETTI_COLOR_VARS = [
  '--color-warning',
  '--color-primary',
  '--color-success',
  '--color-danger',
  '--player-color-violet',
];

function themeColor(name: string): string | null {
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parts = raw.split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return null;
  return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
}

/**
 * Tiny wrapper around canvas-confetti. Three short bursts from random points
 * along the bottom edge — feels like fireworks more than a tickertape dump.
 * Safe to call from useEffect; only fires in the browser.
 */
export function fireWinConfetti(): void {
  if (typeof window === 'undefined') return;
  const colors = CONFETTI_COLOR_VARS.map(themeColor).filter((color) => color !== null);
  const burst = (originX: number, delay = 0) => {
    window.setTimeout(() => {
      confetti({
        particleCount: 80,
        spread: 70,
        startVelocity: 45,
        origin: { x: originX, y: 0.85 },
        colors: colors.length > 0 ? colors : undefined,
      });
    }, delay);
  };
  burst(0.2, 0);
  burst(0.8, 200);
  burst(0.5, 400);
}
