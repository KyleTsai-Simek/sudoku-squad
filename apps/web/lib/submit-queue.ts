/**
 * Serial submit-move queue. Shared between battle-store and coop-store so a
 * rapid burst of moves (especially from keyboard typing) doesn't produce many
 * concurrent in-flight `submit-move` requests racing on the per-room `seq`.
 *
 * Implementation: a single module-level Promise chain. Each call chains on
 * the last pending one and replaces the queue tail with its own (catch-wrapped)
 * promise. A rejected submit doesn't poison the chain — subsequent submits
 * still run, and the caller still sees the original error.
 */
let submitQueue: Promise<unknown> = Promise.resolve();

export function enqueueSubmit<T>(fn: () => Promise<T>): Promise<T> {
  const next = submitQueue.then(fn, fn);
  submitQueue = next.catch(() => undefined);
  return next;
}
