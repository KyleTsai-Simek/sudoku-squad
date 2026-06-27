import { createClient } from '@supabase/supabase-js';
import type { Difficulty } from '@sudoku-squad/core';
import { getSamplePuzzleByCode } from './sample-puzzles';

export interface PublicPuzzle {
  code: string;
  difficulty: Difficulty;
  givens: number[];
}

export async function fetchPublicPuzzle(code: string): Promise<PublicPuzzle | null> {
  const sample = getSamplePuzzleByCode(code);
  if (sample) {
    return {
      code: sample.code,
      difficulty: sample.difficulty,
      givens: sample.givens,
    };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  const client = createClient(url, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const { data, error } = await client
    .from('puzzles_public')
    .select('code, difficulty, givens')
    .eq('code', code)
    .maybeSingle();
  if (error || !data) return null;
  return {
    code: data.code,
    difficulty: data.difficulty as Difficulty,
    givens: data.givens,
  };
}
