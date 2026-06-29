'use client';

import { useGameStore } from '@/lib/game-store';
import { PauseResumeOverlay } from './pause-resume-overlay';

export function SinglePlayerPauseOverlay() {
  const pausedAt = useGameStore((s) => s.pausedAt);
  const resumeGame = useGameStore((s) => s.resumeGame);

  if (pausedAt === null) return null;

  return <PauseResumeOverlay onResume={resumeGame} />;
}
