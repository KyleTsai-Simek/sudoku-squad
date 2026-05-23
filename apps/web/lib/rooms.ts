'use client';

import type { Difficulty } from '@sudoku-squad/core';
import { ensureAuthClient, getSupabase } from './supabase';

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
  is_public?: boolean;
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

/**
 * Coop-only realtime subscription: fire `onInsert` for every new `moves` row
 * landed in this room. Used by coop-store to apply other players' moves as
 * they arrive. Battle mode doesn't need this — each player only sees their
 * own board and submit-move's response is enough for their progress.
 */
export interface ServerMove {
  seq: number;
  player_id: string;
  cell: number;
  kind: 'value' | 'clear' | 'note_toggle';
  value: number | null;
  /** Client-generated idempotency key — present on moves submitted by clients
   *  that opt in (battle-store / coop-store do). Used by the local store to
   *  dedupe its own optimistic apply against the realtime echo. */
  client_move_id: string | null;
}

export async function subscribeToMoves(
  roomId: string,
  onInsert: (move: ServerMove) => void,
  /** Fires when the channel re-subscribes after a disconnect (e.g. a
   *  transient network drop). Callers should resync the move log because
   *  postgres_changes may have dropped events while the channel was down. */
  onReconnect?: () => void,
): Promise<() => void> {
  const client = await ensureAuthClient();
  if (!client) return () => {};
  let hasEverSubscribed = false;
  const channel = client
    .channel(`moves:${roomId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'moves',
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => {
        const row = payload.new as Record<string, unknown>;
        onInsert({
          seq: Number(row.seq),
          player_id: String(row.player_id),
          cell: Number(row.cell),
          kind: row.kind as ServerMove['kind'],
          value: row.value === null ? null : Number(row.value),
          client_move_id:
            typeof row.client_move_id === 'string' ? row.client_move_id : null,
        });
      },
    )
    .subscribe((status) => {
      // Supabase Realtime statuses: 'SUBSCRIBED' | 'CHANNEL_ERROR' |
      // 'TIMED_OUT' | 'CLOSED'. We can't recover from the lost-window
      // between drop and reconnect via the channel itself — the only fix is
      // to refetch the moves table. Fire the callback only on the SECOND+
      // time we hit 'SUBSCRIBED' (the first time is the initial join,
      // which the caller handles separately via fetch).
      if (status === 'SUBSCRIBED') {
        if (hasEverSubscribed && onReconnect) onReconnect();
        hasEverSubscribed = true;
      }
    });
  return () => {
    client.removeChannel(channel);
  };
}

/** One-shot fetch of every move in a room, ordered by seq. Used by coop on
 *  mount + late-join replay to reconstruct the shared board. */
export async function fetchAllMoves(roomId: string): Promise<ServerMove[]> {
  const client = await ensureAuthClient();
  if (!client) return [];
  const { data, error } = await client
    .from('moves')
    .select('seq, player_id, cell, kind, value, client_move_id')
    .eq('room_id', roomId)
    .order('seq', { ascending: true });
  if (error) {
    console.error('fetchAllMoves error', error);
    return [];
  }
  return (data ?? []) as ServerMove[];
}

/** Fetch only the caller's moves for a room. Used by battle-store's resync
 *  path — each battle player has a private board, so we only need their own
 *  log to rematerialize. */
export async function fetchOwnMoves(
  roomId: string,
  playerId: string,
): Promise<ServerMove[]> {
  const client = await ensureAuthClient();
  if (!client) return [];
  const { data, error } = await client
    .from('moves')
    .select('seq, player_id, cell, kind, value, client_move_id')
    .eq('room_id', roomId)
    .eq('player_id', playerId)
    .order('seq', { ascending: true });
  if (error) {
    console.error('fetchOwnMoves error', error);
    return [];
  }
  return (data ?? []) as ServerMove[];
}

export interface RoomPlayerProgress extends RoomPlayer {
  progress_pct: number;
  has_returned: boolean;
}

export async function fetchRoomPlayers(roomId: string): Promise<RoomPlayerProgress[]> {
  const client = await ensureAuthClient();
  if (!client) return [];
  const { data, error } = await client
    .from('room_players')
    .select('player_id, username, color, is_host, progress_pct, has_returned')
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true });
  if (error) {
    console.error('fetchRoomPlayers error', error);
    return [];
  }
  return data ?? [];
}

export async function returnToLobby(roomId: string): Promise<Result<void>> {
  const res = await invoke<{ has_returned: boolean }>('return-to-lobby', {
    room_id: roomId,
  });
  if (!res.ok) return res;
  return { ok: true, value: undefined };
}

export interface RoomRow {
  id: string;
  code: string;
  mode: RoomMode;
  status: RoomStatus;
  puzzle_code: string;
  settings: RoomSettings;
  is_public: boolean;
  winner_player_id: string | null;
  started_at: string | null;
  finished_at: string | null;
}

const ROOM_COLS =
  'id, code, mode, status, puzzle_code, settings, is_public, winner_player_id, started_at, finished_at';

export async function fetchRoom(roomId: string): Promise<RoomRow | null> {
  const client = await ensureAuthClient();
  if (!client) return null;
  const { data, error } = await client
    .from('rooms')
    .select(ROOM_COLS)
    .eq('id', roomId)
    .maybeSingle();
  if (error) {
    console.error('fetchRoom error', error);
    return null;
  }
  if (!data) return null;
  return { ...data, settings: normalizeRoomSettings(data.settings) };
}

export interface PublicLobby {
  id: string;
  code: string;
  mode: RoomMode;
  status: RoomStatus;
  created_at: string;
}

/**
 * List currently-open public rooms (status in lobby/playing). Used by the
 * home page. Cheap query — `rooms_public_idx` partial index covers it.
 */
export async function fetchPublicLobbies(): Promise<PublicLobby[]> {
  const client = getSupabase();
  if (!client) return [];
  const { data, error } = await client
    .from('rooms')
    .select('id, code, mode, status, created_at')
    .eq('is_public', true)
    .in('status', ['lobby', 'playing'])
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    console.error('fetchPublicLobbies error', error);
    return [];
  }
  return data ?? [];
}

export async function subscribeToPublicLobbies(onChange: () => void): Promise<() => void> {
  const client = getSupabase();
  if (!client) return () => {};
  const channel = client
    .channel('public_lobbies')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'rooms' },
      onChange,
    )
    .subscribe();
  return () => {
    client.removeChannel(channel);
  };
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

/** Resolve a puzzle code to its difficulty tier. Used by the lobby to
 *  display the current difficulty (the room itself doesn't store it). */
export async function fetchPuzzleDifficulty(code: string): Promise<Difficulty | null> {
  const client = await ensureAuthClient();
  if (!client) return null;
  const { data, error } = await client
    .from('puzzles_public')
    .select('difficulty')
    .eq('code', code)
    .maybeSingle();
  if (error || !data) return null;
  return data.difficulty as Difficulty;
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
  settings?: Partial<RoomSettings>;
  is_public?: boolean;
}): Promise<Result<{ settings: RoomSettings; is_public: boolean }>> {
  const res = await invoke<{ settings: RoomSettings; is_public: boolean }>(
    'update-room-settings',
    args,
  );
  if (!res.ok) return res;
  return {
    ok: true,
    value: {
      settings: normalizeRoomSettings(res.value.settings),
      is_public: res.value.is_public,
    },
  };
}

export async function changeMode(args: {
  room_id: string;
  mode: RoomMode;
}): Promise<Result<{ mode: RoomMode; changed: boolean }>> {
  const res = await invoke<{ mode: string; changed: boolean }>('change-mode', args);
  if (!res.ok) return res;
  return {
    ok: true,
    value: {
      mode: res.value.mode as RoomMode,
      changed: res.value.changed,
    },
  };
}

export async function changeDifficulty(args: {
  room_id: string;
  difficulty: Difficulty;
}): Promise<Result<{ puzzle_code: string; difficulty: Difficulty }>> {
  const res = await invoke<{ puzzle_code: string; difficulty: string }>(
    'change-difficulty',
    args,
  );
  if (!res.ok) return res;
  return {
    ok: true,
    value: {
      puzzle_code: res.value.puzzle_code,
      difficulty: res.value.difficulty as Difficulty,
    },
  };
}

export async function kickPlayer(args: {
  room_id: string;
  player_id: string;
}): Promise<Result<void>> {
  const res = await invoke<{ kicked: boolean }>('kick-player', args);
  if (!res.ok) return res;
  return { ok: true, value: undefined };
}

export interface SubmitMoveResponse {
  seq: number;
  accepted: boolean;
  progress_pct: number;
  won: boolean;
  is_winner: boolean;
  /** True when this call was an idempotent retry of a client_move_id the
   *  server had already accepted. Treat as success either way. */
  idempotent?: boolean;
  /** Present only when `room.settings.autoCheck` is true and the move was a `value`. */
  cell_correct?: boolean;
}

export async function submitMove(args: {
  room_id: string;
  cell: number;
  kind: 'value' | 'clear' | 'note_toggle';
  value?: number | null;
  /** Optional client idempotency key. When set, retries with the same key
   *  return the original seq + state instead of inserting twice. */
  client_move_id?: string | null;
}): Promise<Result<SubmitMoveResponse>> {
  return invoke<SubmitMoveResponse>('submit-move', args);
}

export interface BatchMoveInput {
  cell: number;
  kind: 'value' | 'clear' | 'note_toggle';
  value?: number | null;
  client_move_id?: string | null;
}

export interface BatchMoveResult {
  seq: number;
  accepted: true;
  idempotent?: true;
  cell_correct?: boolean;
}

export interface SubmitMovesResponse {
  results: BatchMoveResult[];
  progress_pct: number;
  won: boolean;
  is_winner: boolean;
  shared_win?: boolean;
}

/**
 * Batched submit. Accepts an array of moves; the server reserves N
 * consecutive seqs in one round-trip, inserts them in one transaction,
 * materializes the board once at the end, and returns per-move results
 * plus the aggregate progress / win state.
 *
 * Used by the store-level batching queue to collapse bursts of typing
 * into a single HTTP request. See DECISIONS #0037.
 */
export async function submitMoves(args: {
  room_id: string;
  moves: BatchMoveInput[];
}): Promise<Result<SubmitMovesResponse>> {
  return invoke<SubmitMovesResponse>('submit-move', args);
}
