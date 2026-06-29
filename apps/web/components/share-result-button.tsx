'use client';

import { useState } from 'react';
import type { Difficulty } from '@sudoku-squad/core';
import { buildShareMessage, buildShareTitle } from '@/lib/share-copy';
import { buildAbsoluteShareUrl, type ShareMode } from '@/lib/share-url';
import { IosShareIcon } from './material-icons';

export interface ShareResultInput {
  puzzleCode: string;
  difficulty: Difficulty;
  solveTimeMs: number;
  mode: ShareMode;
  dailyDate?: string;
  roomCode?: string;
  playerCount?: number;
}

interface Props {
  result: ShareResultInput;
  variant?: 'primary' | 'secondary';
}

type ShareState = 'idle' | 'sharing' | 'copied' | 'error';

export function ShareResultButton({ result, variant = 'secondary' }: Props) {
  const [state, setState] = useState<ShareState>('idle');

  async function onShare() {
    setState('sharing');
    try {
      const url = buildAbsoluteShareUrl(result, window.location.origin);
      const title = buildShareTitle(result);
      const text = buildShareMessage(result);
      if (navigator.share) {
        await navigator.share({ title, text, url });
        setState('idle');
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setState('copied');
      window.setTimeout(() => setState('idle'), 1600);
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') {
        setState('idle');
        return;
      }
      console.error('share result failed', error);
      setState('error');
      window.setTimeout(() => setState('idle'), 2200);
    }
  }

  const label =
    state === 'sharing'
      ? 'Preparing…'
      : state === 'copied'
        ? 'Copied share link'
        : state === 'error'
          ? 'Share unavailable'
          : 'Share';

  return (
    <button
      type="button"
      onClick={onShare}
      disabled={state === 'sharing'}
      className={
        variant === 'primary'
          ? 'inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60'
          : 'inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-surface-muted disabled:opacity-60'
      }
    >
      <IosShareIcon size={18} />
      {label}
    </button>
  );
}
