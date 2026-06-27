import { NextRequest, NextResponse } from 'next/server';
import type { Difficulty } from '@sudoku-squad/core';
import { createShareToken, type ShareMode, type ShareTokenPayload } from '@/lib/share-token';

export const runtime = 'nodejs';

const VALID_DIFFICULTIES = new Set<Difficulty>([
  'easy',
  'medium',
  'hard',
  'expert',
  'extreme',
  'killer',
]);
const VALID_MODES = new Set<ShareMode>(['single', 'battle', 'coop']);

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const payload = normalizePayload(body);
  if (!payload) {
    return NextResponse.json({ error: 'invalid_share_payload' }, { status: 400 });
  }

  try {
    const token = createShareToken(payload);
    const url = new URL(`/s/${token}`, request.url).toString();
    return NextResponse.json({ token, url });
  } catch (error) {
    console.error('create share token failed', error);
    return NextResponse.json({ error: 'share_unavailable' }, { status: 500 });
  }
}

function normalizePayload(input: unknown): ShareTokenPayload | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const puzzleCode = typeof raw.puzzleCode === 'string' ? raw.puzzleCode : null;
  const difficulty = raw.difficulty as Difficulty;
  const mode = raw.mode as ShareMode;
  const solveTimeMs = Number(raw.solveTimeMs);

  if (!puzzleCode || !/^[a-z0-9]{3,16}$/.test(puzzleCode)) return null;
  if (!VALID_DIFFICULTIES.has(difficulty)) return null;
  if (!VALID_MODES.has(mode)) return null;
  if (!Number.isFinite(solveTimeMs) || solveTimeMs < 0 || solveTimeMs > 24 * 60 * 60 * 1000) {
    return null;
  }

  const dailyDate = typeof raw.dailyDate === 'string' ? raw.dailyDate : undefined;
  if (dailyDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(dailyDate)) return null;

  const roomCode = typeof raw.roomCode === 'string' ? raw.roomCode : undefined;
  if (roomCode !== undefined && !/^[a-z0-9]{3,16}$/.test(roomCode)) return null;

  const playerCount = raw.playerCount === undefined ? undefined : Number(raw.playerCount);
  if (
    playerCount !== undefined &&
    (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > 8)
  ) {
    return null;
  }

  return {
    version: 1,
    puzzleCode,
    difficulty,
    mode,
    solveTimeMs,
    ...(dailyDate ? { dailyDate } : {}),
    ...(roomCode ? { roomCode } : {}),
    ...(playerCount ? { playerCount } : {}),
  };
}
