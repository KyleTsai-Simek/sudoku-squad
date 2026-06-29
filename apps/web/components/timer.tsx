'use client';

import { useEffect, useState } from 'react';
import { useGameStore } from '@/lib/game-store';

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function Timer() {
  const startedAt = useGameStore((s) => s.startedAt);
  const finishedAt = useGameStore((s) => s.finishedAt);
  const pausedAt = useGameStore((s) => s.pausedAt);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (startedAt === null || finishedAt !== null || pausedAt !== null) return;
    const handle = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(handle);
  }, [startedAt, finishedAt, pausedAt]);

  if (startedAt === null) return null;
  const elapsed = (finishedAt ?? pausedAt ?? now) - startedAt;
  return (
    <span
      aria-label="Elapsed time"
      className="tabular-nums font-mono text-base text-muted"
    >
      {formatElapsed(elapsed)}
    </span>
  );
}
