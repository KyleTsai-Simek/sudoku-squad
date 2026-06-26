'use client';

import { ensureAuthClient } from './supabase';

export const DEFAULT_LEADERBOARD_LIMIT = 25;

export type LeaderboardKey = 'total_completions';

export interface LeaderboardEntry {
  leaderboardKey: LeaderboardKey;
  rank: number;
  playerId: string;
  username: string;
  completedCount: number;
  isCurrentUser: boolean;
  totalRankedPlayers: number;
}

interface CompletionLeaderboardRow {
  leaderboard_key: LeaderboardKey;
  rank_position: number;
  player_id: string;
  username: string;
  completed_count: number;
  is_current_user: boolean;
  total_ranked_players: number;
}

export async function getCompletionLeaderboard({
  limit = DEFAULT_LEADERBOARD_LIMIT,
  offset = 0,
}: {
  limit?: number;
  offset?: number;
} = {}): Promise<LeaderboardEntry[] | null> {
  const client = await ensureAuthClient();
  if (!client) return null;

  const { data, error } = await client.rpc('get_completion_leaderboard', {
    p_limit: limit,
    p_offset: offset,
    p_leaderboard_key: 'total_completions',
  });
  if (error) {
    console.error('get_completion_leaderboard error', error);
    return null;
  }

  return ((data ?? []) as CompletionLeaderboardRow[]).map((row) => ({
    leaderboardKey: row.leaderboard_key,
    rank: row.rank_position,
    playerId: row.player_id,
    username: row.username,
    completedCount: row.completed_count,
    isCurrentUser: row.is_current_user,
    totalRankedPlayers: row.total_ranked_players,
  }));
}
