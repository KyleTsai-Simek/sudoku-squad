/**
 * Sequence-log helpers for the server-ordered move log shared by coop (and,
 * later, battle + iOS). The move log is an append-only list of moves, each
 * stamped with a per-room monotonic `seq` assigned by the server. start-game
 * resets the counter to 1, so a healthy log holds the contiguous range
 * `[1, max]`.
 *
 * Two things perturb that ideal and these helpers reconcile both:
 *   - **Dropped realtime events** — `postgres_changes` is not a reliable
 *     delivery channel, so a client can be missing a seq it should have.
 *     That's a *recoverable* hole: refetch and it fills.
 *   - **Abandoned reservations** — submit-move's 23505 dup-race path reserves
 *     a fresh seq block and abandons the original, leaving a *permanent* hole
 *     that the server will never fill. Treating it as a dropped event causes a
 *     resync storm.
 *
 * Callers track a `knownMissing` set (seqs proven absent from the server's
 * authoritative log) so gap detection can tell the two apart. These functions
 * are pure — the caller owns that set. See DECISIONS #0036/#0037/#0040.
 */

function toPresentSet(presentSeqs: Iterable<number>): { present: Set<number>; max: number } {
  const present = presentSeqs instanceof Set ? presentSeqs : new Set(presentSeqs);
  let max = 0;
  for (const s of present) if (s > max) max = s;
  return { present, max };
}

/**
 * Every hole in `[1, max]` of an *authoritative* snapshot (a full or delta
 * fetch direct from the server). A hole still absent right after such a fetch
 * is, by definition, an abandoned reservation rather than a dropped event —
 * so the result is exactly the set of seqs to treat as permanently missing.
 * Recompute on every authoritative fetch; the result is self-healing (a seq
 * that later turns out to exist drops out at the next recompute).
 */
export function computeAbandonedHoles(presentSeqs: Iterable<number>): Set<number> {
  const { present, max } = toPresentSet(presentSeqs);
  const holes = new Set<number>();
  for (let s = 1; s <= max; s++) {
    if (!present.has(s)) holes.add(s);
  }
  return holes;
}

/**
 * True if there's a seq in `[1, max]` we neither hold nor know to be
 * abandoned — i.e. a genuinely-suspicious hole that warrants a resync.
 */
export function hasSeqGap(
  presentSeqs: Iterable<number>,
  knownMissing: ReadonlySet<number>,
): boolean {
  const { present, max } = toPresentSet(presentSeqs);
  for (let s = 1; s <= max; s++) {
    if (!present.has(s) && !knownMissing.has(s)) return true;
  }
  return false;
}

/**
 * The lowest seq a delta resync should refetch from: the first suspicious hole
 * (neither held nor known-abandoned), or `max + 1` if the prefix is contiguous
 * (a pure catch-up of newer moves). Returns 1 when nothing is held yet (cold
 * start fetches everything). Lets a resync fetch only the tail/holes instead
 * of re-reading the whole log.
 */
export function firstMissingSeq(
  presentSeqs: Iterable<number>,
  knownMissing: ReadonlySet<number>,
): number {
  const { present, max } = toPresentSet(presentSeqs);
  if (max === 0) return 1;
  for (let s = 1; s <= max; s++) {
    if (!present.has(s) && !knownMissing.has(s)) return s;
  }
  return max + 1;
}
