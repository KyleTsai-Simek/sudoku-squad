import { difficultyLabel } from './difficulty-labels';
import type { ShareMode } from './share-token';
import type { Difficulty } from '@sudoku-squad/core';

export interface ShareCopyPayload {
  difficulty: Difficulty;
  solveTimeMs: number;
  mode: ShareMode;
  url?: string;
  playerCount?: number;
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

export function shareModeLabel(mode: ShareMode): string {
  if (mode === 'battle') return 'battle';
  if (mode === 'coop') return 'co-op';
  return 'Sudoku Squad';
}

export function buildShareMessage(payload: ShareCopyPayload): string {
  const difficulty = difficultyLabel(payload.difficulty);
  const time = formatShareTime(payload.solveTimeMs);
  const modeDetail = payload.mode === 'single' ? '' : ` ${shareModeLabel(payload.mode)}`;
  const playerDetail = payload.playerCount ? ` with ${payload.playerCount} players` : '';
  const text = `Try this ${difficulty} Sudoku Squad${modeDetail} puzzle${playerDetail}. I finished in ${time}.`;
  return payload.url ? `${text}\n${payload.url}` : text;
}

export function buildShareTitle(payload: Pick<ShareCopyPayload, 'difficulty'>): string {
  return `Try this ${difficultyLabel(payload.difficulty)} Sudoku Squad puzzle`;
}
