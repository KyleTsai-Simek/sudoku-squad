import { createHmac, timingSafeEqual } from 'crypto';
import type { Difficulty } from '@sudoku-squad/core';

export type ShareMode = 'single' | 'battle' | 'coop';

export interface ShareTokenPayload {
  version: 1;
  puzzleCode: string;
  difficulty: Difficulty;
  solveTimeMs: number;
  mode: ShareMode;
  dailyDate?: string;
  roomCode?: string;
  playerCount?: number;
}

interface EncodedPayload {
  v: 1;
  c: string;
  d: Difficulty;
  t: number;
  m: ShareMode;
  dd?: string;
  r?: string;
  pc?: number;
}

const VALID_DIFFICULTIES = new Set<Difficulty>([
  'easy',
  'medium',
  'hard',
  'expert',
  'extreme',
  'killer',
]);
const VALID_MODES = new Set<ShareMode>(['single', 'battle', 'coop']);
const MAX_SOLVE_TIME_MS = 24 * 60 * 60 * 1000;

function secret(): string {
  const configured = process.env.SHARE_TOKEN_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SHARE_TOKEN_SECRET is required in production');
  }
  return 'sudoku-squad-local-share-secret';
}

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(unsigned: string): string {
  return createHmac('sha256', secret()).update(unsigned).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function toEncoded(payload: ShareTokenPayload): EncodedPayload {
  return {
    v: 1,
    c: payload.puzzleCode,
    d: payload.difficulty,
    t: Math.round(payload.solveTimeMs),
    m: payload.mode,
    ...(payload.dailyDate ? { dd: payload.dailyDate } : {}),
    ...(payload.roomCode ? { r: payload.roomCode } : {}),
    ...(payload.playerCount ? { pc: payload.playerCount } : {}),
  };
}

function fromEncoded(encoded: EncodedPayload): ShareTokenPayload | null {
  if (encoded.v !== 1) return null;
  if (typeof encoded.c !== 'string' || !/^[a-z0-9]{3,16}$/.test(encoded.c)) return null;
  if (!VALID_DIFFICULTIES.has(encoded.d)) return null;
  if (!VALID_MODES.has(encoded.m)) return null;
  if (!Number.isFinite(encoded.t) || encoded.t < 0 || encoded.t > MAX_SOLVE_TIME_MS) return null;
  if (encoded.dd !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(encoded.dd)) return null;
  if (encoded.r !== undefined && !/^[a-z0-9]{3,16}$/.test(encoded.r)) return null;
  if (
    encoded.pc !== undefined &&
    (!Number.isInteger(encoded.pc) || encoded.pc < 1 || encoded.pc > 8)
  ) {
    return null;
  }
  return {
    version: 1,
    puzzleCode: encoded.c,
    difficulty: encoded.d,
    solveTimeMs: encoded.t,
    mode: encoded.m,
    ...(encoded.dd ? { dailyDate: encoded.dd } : {}),
    ...(encoded.r ? { roomCode: encoded.r } : {}),
    ...(encoded.pc ? { playerCount: encoded.pc } : {}),
  };
}

export function createShareToken(payload: ShareTokenPayload): string {
  const unsigned = encodeBase64Url(JSON.stringify(toEncoded(payload)));
  return `${unsigned}.${sign(unsigned)}`;
}

export function verifyShareToken(token: string): ShareTokenPayload | null {
  const [unsigned, signature, ...rest] = token.split('.');
  if (!unsigned || !signature || rest.length > 0) return null;
  if (!safeEqual(sign(unsigned), signature)) return null;
  try {
    const decoded = JSON.parse(decodeBase64Url(unsigned)) as EncodedPayload;
    return fromEncoded(decoded);
  } catch {
    return null;
  }
}
