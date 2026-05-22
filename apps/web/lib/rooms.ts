'use client';

import type { Difficulty } from '@sudoku-squad/core';
import { ensureAuthClient } from './supabase';

export type RoomMode = 'battle' | 'coop';
export type RoomStatus = 'lobby' | 'playing' | 'finished';

/** Mirrors supabase/functions/_shared/settings.ts. Keep in sync. */
export interface RoomSettings {
  showConflicts: boolean;
  autoCheck: boolean;
  highlightSameValue: boolean;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  showConflicts: true,
  autoCheck: false,
  highlightSameValue: true,
};

export function normalizeRoomSettings(input: unknown): RoomSettings {
  if (!input || typeof input !== 'object') return { ...DEFAULT_ROOM_SETTINGS };
  const i = input as Record<string, unknown>;
  return {
    showConflicts:
      typeof i.showConflicts === 'boolean' ? i.showConflicts : DEFAULT_ROOM_SETTINGS.showConflicts,
    autoCheck: typeof i.autoCheck === 'boolean' ? i.autoCheck : DEFAULT_ROOM_SETTINGS.autoCheck,
    highlightSameValue:
      typeof i.highlightSameValue === 'boolean'
        ? i.highlightSameValue
        : DEFAULT_ROOM_SETTINGS.highlightSameValue,
  };
}

export interface RoomPlayer {
  player_id: string;
  username: string;
  color: string;
  is_host: boolean;
}

export interface RoomState {
  room_id: string;
  room_code: string;
  mode: RoomMode;
  status: RoomStatus;
  puzzle_code: string;
  // Caller-relative fields. Populated after create/join.
  own_player_id: string;
  own_color: string;
  own_is_host: boolean;
}

export interface RoomError {
  code:
    | 'unauthenticated'
    | 'bad_request'
    | 'forbidden'
    | 'not_found'
    | 'room_in_progress'
    | 'room_finished'
    | 'room_full'
    | 'too_few_players'
    | 'invalid_move'
    | 'internal'
    | 'no_supabase';
  message: string;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: RoomError };

async function invoke<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<Result<T>> {
  const client = await ensureAuthClient();
  if (!client) {
    return {
      ok: false,
      error: {
        code: 'no_supabase',
        message: 'Supabase env not configured in this environment.',
      },
    };
  }
  const { data, error } = await client.functions.invoke(name, { body });
  if (error) {
    // FunctionsHttpError includes the body in `context.response`.
    let inner: RoomError | null = null;
    try {
      const ctx = (error as { context?: { response?: Response } }).context;
      if (ctx?.response) {
        const parsed = await ctx.response.clone().json();
        if (parsed?.error?.code) inner = parsed.error as RoomError;
      }
    } catch {}
    return {
      ok: false,
      error: inner ?? { code: 'internal', message: error.message },
    };
  }
  return { ok: true, value: data as T };
}

interface CreateRoomResponse {
  room_id: string;
  room_code: string;
  mode: RoomMode;
  puzzle_code: string;
  player_id: string;
  color: string;
}

export async function createRoom(args: {
  mode: RoomMode;
  difficulty: Difficulty;
  username: string;
}): Promise<Result<RoomState>> {
  const res = await invoke<CreateRoomResponse>('create-room', args);
  if (!res.ok) return res;
  const v = res.value;
  return {
    ok: true,
    value: {
      room_id: v.room_id,
      room_code: v.room_code,
      mode: v.mode,
      status: 'lobby',
      puzzle_code: v.puzzle_code,
      own_player_id: v.player_id,
      own_color: v.color,
      own_is_host: true,
    },
  };
}

interface JoinRoomResponse {
  room_id: string;
  room_code: string;
  mode: RoomMode;
  status: RoomStatus;
  puzzle_code: string;
  player_id: string;
  color: string;
  is_host: boolean;
  rejoined: boolean;
}

export async function joinRoom(args: {
  code: string;
  username: string;
}): Promise<Result<RoomState>> {
  const res = await invoke<JoinRoomResponse>('join-room', args);
  if (!res.ok) return res;
  const v = res.value;
  return {
    ok: true,
    value: {
      room_id: v.room_id,
      room_code: v.room_code,
      mode: v.mode,
      status: v.status,
      puzzle_code: v.puzzle_code,
      own_player_id: v.player_id,
      own_color: v.color,
      own_is_host: v.is_host,
    },
  };
}

/**
 * Subscribe to room_players changes so the lobby UI can render players as
 * they join. Returns a cleanup function.
 *
 * Reuses the same Supabase client (auth-aware) — Realtime needs the JWT for
 * RLS-respecting subscriptions.
 */
export async function subscribeToRoomPlayers(
  roomId: string,
  onChange: () => void,
): Promise<() => void> {
  const client = await ensureAuthClient();
  if (!client) return () => {};
  const channel = client
    .channel(`room_players:${roomId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'room_players',
        filter: `room_id=eq.${roomId}`,
      },
      onChange,
    )
    .subscribe();
  return () => {
    client.removeChannel(channel);
  };
}

export interface RoomPlayerProgress extends RoomPlayer {
  progress_pct: number;
}

export async function fetchRoomPlayers(roomId: string): Promise<RoomPlayerProgress[]> {
  const client = await ensureAuthClient();
  if (!client) return [];
  const { data, error } = await client
    .from('room_players')
    .select('player_id, username, color, is_host, progress_pct')
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true });
  if (error) {
    console.error('fetchRoomPlayers error', error);
    return [];
  }
  return data ?? [];
}

export interface RoomRow {
  id: string;
  code: string;
  mode: RoomMode;
  status: RoomStatus;
  puzzle_code: string;
  settings: RoomSettings;
  winner_player_id: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export async function fetchRoom(roomId: string): Promise<RoomRow | null> {
  const client = await ensureAuthClient();
  if (!client) return null;
  const { data, error } = await client
    .from('rooms')
    .select(
      'id, code, mode, status, puzzle_code, settings, winner_player_id, started_at, finished_at',
    )
    .eq('id', roomId)
    .maybeSingle();
  if (error) {
    console.error('fetchRoom error', error);
    return null;
  }
  if (!data) return null;
  return { ...data, settings: normalizeRoomSettings(data.settings) };
}

export async function subscribeToRoom(
  roomId: string,
  onChange: () => void,
): Promise<() => void> {
  const client = await ensureAuthClient();
  if (!client) return () => {};
  const channel = client
    .channel(`rooms:${roomId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
      onChange,
    )
    .subscribe();
  return () => {
    client.removeChannel(channel);
  };
}

export interface PuzzleGivens {
  code: string;
  givens: number[];
}

/** Battle/coop puzzle fetch — uses puzzles_public, no solution. */
export async function fetchPuzzleGivens(code: string): Promise<PuzzleGivens | null> {
  const client = await ensureAuthClient();
  if (!client) return null;
  const { data, error } = await client
    .from('puzzles_public')
    .select('code, givens')
    .eq('code', code)
    .maybeSingle();
  if (error || !data) return null;
  return { code: data.code, givens: data.givens };
}

export async function startGame(roomId: string): Promise<Result<void>> {
  const res = await invoke<{ room_id: string; status: string }>('start-game', {
    room_id: roomId,
  });
  if (!res.ok) return res;
  return { ok: true, value: undefined };
}

export async function updateRoomSettings(args: {
  room_id: string;
  settings: Partial<RoomSettings>;
}): Promise<Result<RoomSettings>> {
  const res = await invoke<{ settings: RoomSettings }>('update-room-settings', args);
  if (!res.ok) return res;
  return { ok: true, value: normalizeRoomSettings(res.value.settings) };
}

export interface SubmitMoveResponse {
  seq: number;
  accepted: boolean;
  progress_pct: number;
  won: boolean;
  is_winner: boolean;
  /** Present only when `room.settings.autoCheck` is true and the move was a `value`. */
  cell_correct?: boolean;
}

export async function submitMove(args: {
  room_id: string;
  cell: number;
  kind: 'value' | 'clear' | 'note_toggle';
  value?: number | null;
}): Promise<Result<SubmitMoveResponse>> {
  return invoke<SubmitMoveResponse>('submit-move', args);
}
