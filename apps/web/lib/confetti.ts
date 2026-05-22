'use client';

import confetti from 'canvas-confetti';

/**
 * Tiny wrapper around canvas-confetti. Three short bursts from random points
 * along the bottom edge — feels like fireworks more than a tickertape dump.
 * Safe to call from useEffect; only fires in the browser.
 */
export function fireWinConfetti(): void {
  if (typeof window === 'undefined') return;
  const burst = (originX: number, delay = 0) => {
    window.setTimeout(() => {
      confetti({
        particleCount: 80,
        spread: 70,
        startVelocity: 45,
        origin: { x: originX, y: 0.85 },
        colors: ['#f59e0b', '#0ea5e9', '#10b981', '#f43f5e', '#8b5cf6'],
      });
    }, delay);
  };
  burst(0.2, 0);
  burst(0.8, 200);
  burst(0.5, 400);
}
