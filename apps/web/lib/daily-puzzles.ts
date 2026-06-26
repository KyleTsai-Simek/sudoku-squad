'use client';

import type { PuzzleCode } from '@sudoku-squad/core';
import { ensureAuthClient } from './supabase';

export type DailyDifficulty = 'easy' | 'medium' | 'hard';

export interface DailyPuzzle {
  date: string;
  difficulty: DailyDifficulty;
  code: PuzzleCode;
  givens: number[];
}

export interface DailyCompletion {
  date: string;
  difficulty: DailyDifficulty;
  code: PuzzleCode;
  completedAt: string;
  solveTimeMs: number | null;
}

interface DailyPuzzleRow {
  puzzle_date: string;
  difficulty: string;
  puzzle_code: PuzzleCode;
  givens: number[];
}

interface DailyCompletionRow {
  puzzle_date: string;
  difficulty: string;
  puzzle_code: PuzzleCode;
  completed_at: string;
  solve_time_ms: number | null;
}

export async function getDailyPuzzles(): Promise<DailyPuzzle[]> {
  const client = await ensureAuthClient();
  if (!client) return [];
  const { data, error } = await client.rpc('get_daily_puzzles', { p_date: null });
  if (error) {
    console.error('get_daily_puzzles error', error);
    return [];
  }
  return ((data ?? []) as DailyPuzzleRow[]).map((row) => ({
    date: row.puzzle_date,
    difficulty: row.difficulty as DailyDifficulty,
    code: row.puzzle_code,
    givens: row.givens,
  }));
}

export async function getDailyCompletions(date: string): Promise<DailyCompletion[]> {
  const client = await ensureAuthClient();
  if (!client) return [];
  const { data, error } = await client
    .from('player_daily_completions')
    .select('puzzle_date, difficulty, puzzle_code, completed_at, solve_time_ms')
    .eq('puzzle_date', date);
  if (error) {
    console.error('player_daily_completions read error', error);
    return [];
  }
  return ((data ?? []) as DailyCompletionRow[]).map((row) => ({
    date: row.puzzle_date,
    difficulty: row.difficulty as DailyDifficulty,
    code: row.puzzle_code,
    completedAt: row.completed_at,
    solveTimeMs: row.solve_time_ms,
  }));
}
