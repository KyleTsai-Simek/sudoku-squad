import { difficultyLabel } from './difficulty-labels';
import type { Difficulty } from '@sudoku-squad/core';

export interface ShareCopyPayload {
  difficulty: Difficulty;
  solveTimeMs: number;
}

export function formatShareTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function buildShareMessage(payload: ShareCopyPayload): string {
  const difficulty = difficultyLabel(payload.difficulty).toLowerCase();
  const time = formatShareTime(payload.solveTimeMs);
  return `Try this ${difficulty} puzzle. I finished in ${time}!`;
}

export function buildShareTitle(payload: Pick<ShareCopyPayload, 'difficulty'>): string {
  return `Try this ${difficultyLabel(payload.difficulty)} puzzle`;
}
