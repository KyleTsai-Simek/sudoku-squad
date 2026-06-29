import type { Difficulty } from '@sudoku-squad/core';

export type ShareMode = 'single' | 'battle' | 'coop';

export interface ShareUrlPayload {
  puzzleCode: string;
  solveTimeMs: number;
  dailyDate?: string;
}

const MAX_SHARE_TIME_SECONDS = 24 * 60 * 60;
const PUZZLE_CODE_PATTERN = /^[a-z0-9]{3,16}$/;
const SHARE_TIME_PATTERN = /^[0-9a-z]+$/;
const DAILY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function encodeShareTime(solveTimeMs: number): string {
  const seconds = Math.max(0, Math.floor(solveTimeMs / 1000));
  return Math.min(seconds, MAX_SHARE_TIME_SECONDS).toString(36);
}

export function decodeShareTime(time: string): number | null {
  if (!SHARE_TIME_PATTERN.test(time)) return null;
  const seconds = Number.parseInt(time, 36);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_SHARE_TIME_SECONDS) {
    return null;
  }
  return seconds * 1000;
}

export function isValidShareCode(code: string): boolean {
  return PUZZLE_CODE_PATTERN.test(code);
}

export function isValidDailyDate(date: string | undefined): date is string {
  return typeof date === 'string' && DAILY_DATE_PATTERN.test(date);
}

export function buildSharePath(payload: ShareUrlPayload): string {
  const code = payload.puzzleCode.toLowerCase();
  const path = `/s/${code}/${encodeShareTime(payload.solveTimeMs)}`;
  return isValidDailyDate(payload.dailyDate)
    ? `${path}?d=${encodeURIComponent(payload.dailyDate)}`
    : path;
}

export function buildAbsoluteShareUrl(payload: ShareUrlPayload, origin: string): string {
  return new URL(buildSharePath(payload), origin).toString();
}

export function buildPlayHref({
  puzzleCode,
  dailyDate,
  difficulty,
}: {
  puzzleCode: string;
  dailyDate?: string;
  difficulty: Difficulty;
}): string {
  if (!isValidDailyDate(dailyDate) || !isDailyDifficulty(difficulty)) {
    return `/play/${puzzleCode}`;
  }
  const params = new URLSearchParams({
    daily: dailyDate,
    dailyDifficulty: difficulty,
  });
  return `/play/${puzzleCode}?${params.toString()}`;
}

function isDailyDifficulty(difficulty: Difficulty): difficulty is 'easy' | 'medium' | 'hard' {
  return difficulty === 'easy' || difficulty === 'medium' || difficulty === 'hard';
}
