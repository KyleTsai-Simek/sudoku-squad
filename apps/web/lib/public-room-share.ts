import { createClient } from '@supabase/supabase-js';
import type { RoomMode, RoomStatus } from './rooms';
import { fetchPublicPuzzle, type PublicPuzzle } from './public-puzzle';

export interface PublicRoomShare {
  code: string;
  mode: RoomMode;
  status: RoomStatus;
  puzzle: PublicPuzzle | null;
}

export async function fetchPublicRoomShare(code: string): Promise<PublicRoomShare | null> {
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
    .from('rooms')
    .select('code, mode, status, puzzle_code')
    .eq('code', code)
    .maybeSingle();
  if (error || !data) return null;

  const puzzleCode =
    typeof data.puzzle_code === 'string' ? data.puzzle_code : '';
  return {
    code: data.code,
    mode: data.mode as RoomMode,
    status: data.status as RoomStatus,
    puzzle: puzzleCode ? await fetchPublicPuzzle(puzzleCode) : null,
  };
}
