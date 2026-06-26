import { DIFFICULTIES_VISIBLE, type Difficulty } from '@sudoku-squad/core';

export const VISIBLE_DIFFICULTIES = DIFFICULTIES_VISIBLE;

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  expert: 'Expert',
  extreme: 'Extreme',
  killer: 'Killer',
};

export function difficultyLabel(difficulty: Difficulty): string {
  return DIFFICULTY_LABEL[difficulty];
}
