import { Suspense } from 'react';
import { PlayClient } from './play-client';

export default function PlayPage() {
  return (
    <Suspense fallback={<div className="p-8 text-stone-500">Loading…</div>}>
      <PlayClient />
    </Suspense>
  );
}
