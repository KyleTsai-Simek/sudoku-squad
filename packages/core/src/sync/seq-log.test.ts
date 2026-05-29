import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeAbandonedHoles, firstMissingSeq, hasSeqGap } from './seq-log';

const NONE: ReadonlySet<number> = new Set();

describe('computeAbandonedHoles', () => {
  it('is empty for a contiguous 1..max log', () => {
    expect(computeAbandonedHoles([1, 2, 3, 4])).toEqual(new Set());
  });

  it('is empty for an empty log', () => {
    expect(computeAbandonedHoles([])).toEqual(new Set());
  });

  it('reports every hole below max', () => {
    // 1,2,4,7 held → 3,5,6 are holes.
    expect(computeAbandonedHoles([1, 2, 4, 7])).toEqual(new Set([3, 5, 6]));
  });

  it('ignores order and duplicates', () => {
    expect(computeAbandonedHoles([4, 2, 2, 1])).toEqual(new Set([3]));
  });
});

describe('hasSeqGap', () => {
  it('false for a contiguous log', () => {
    expect(hasSeqGap([1, 2, 3], NONE)).toBe(false);
  });

  it('false for an empty log', () => {
    expect(hasSeqGap([], NONE)).toBe(false);
  });

  it('true for an unexplained hole', () => {
    expect(hasSeqGap([1, 2, 4], NONE)).toBe(true);
  });

  it('false when the only hole is known-abandoned (no resync storm)', () => {
    // 3 was abandoned by a 23505 re-reserve; we hold 1,2,4 and know 3 is gone.
    expect(hasSeqGap([1, 2, 4], new Set([3]))).toBe(false);
  });

  it('true when there is a real hole alongside a known-abandoned one', () => {
    // 3 abandoned (known); 5 genuinely missing (dropped event) → still a gap.
    expect(hasSeqGap([1, 2, 4, 6], new Set([3]))).toBe(true);
  });
});

describe('firstMissingSeq', () => {
  it('returns 1 for an empty log (cold start fetches everything)', () => {
    expect(firstMissingSeq([], NONE)).toBe(1);
  });

  it('returns max+1 for a contiguous log (pure catch-up)', () => {
    expect(firstMissingSeq([1, 2, 3], NONE)).toBe(4);
  });

  it('returns the first real hole', () => {
    expect(firstMissingSeq([1, 2, 4, 5], NONE)).toBe(3);
  });

  it('skips a known-abandoned hole and finds the next real one', () => {
    // 2 abandoned; first refetch-worthy hole is 4.
    expect(firstMissingSeq([1, 3, 5], new Set([2])).valueOf()).toBe(4);
  });

  it('returns max+1 when every hole is known-abandoned', () => {
    // Hold 1,3; 2 abandoned → nothing to refetch below max → catch up at 4.
    expect(firstMissingSeq([1, 3], new Set([2]))).toBe(4);
  });
});

describe('properties', () => {
  const seqArb = fc.array(fc.integer({ min: 1, max: 60 }), { maxLength: 60 });

  it('after recomputing abandoned holes from a snapshot, hasSeqGap is false', () => {
    // The core self-healing guarantee: treat the snapshot as authoritative,
    // mark its holes abandoned, and there is no remaining "suspicious" gap.
    fc.assert(
      fc.property(seqArb, (seqs) => {
        const known = computeAbandonedHoles(seqs);
        expect(hasSeqGap(seqs, known)).toBe(false);
      }),
    );
  });

  it('firstMissingSeq is always > 0 and never a seq we already hold', () => {
    fc.assert(
      fc.property(seqArb, (seqs) => {
        const present = new Set(seqs);
        const f = firstMissingSeq(seqs, NONE);
        expect(f).toBeGreaterThan(0);
        expect(present.has(f)).toBe(false);
      }),
    );
  });

  it('with all holes known-abandoned, firstMissingSeq === max+1 (only catch-up)', () => {
    fc.assert(
      fc.property(seqArb, (seqs) => {
        const known = computeAbandonedHoles(seqs);
        const max = seqs.length === 0 ? 0 : Math.max(...seqs);
        const expected = max + 1 === 1 && seqs.length === 0 ? 1 : max + 1;
        expect(firstMissingSeq(seqs, known)).toBe(expected);
      }),
    );
  });

  it('a delta fetch from firstMissingSeq, merged in, closes every suspicious gap', () => {
    // Model: we hold `seqs`; the server authoritatively holds `1..serverMax`.
    // Fetching everything >= firstMissingSeq and merging must leave no gap
    // that isn't a genuine server-side hole.
    fc.assert(
      fc.property(seqArb, fc.integer({ min: 0, max: 60 }), (seqs, serverMax) => {
        const known0 = computeAbandonedHoles(seqs); // what we knew before
        const since = firstMissingSeq(seqs, known0);
        const merged = new Set(seqs);
        // Server delta: every seq in [since, serverMax].
        for (let s = since; s <= serverMax; s++) merged.add(s);
        const knownAfter = computeAbandonedHoles(merged);
        // The merged set is our new authoritative snapshot → no suspicious gap.
        expect(hasSeqGap(merged, knownAfter)).toBe(false);
      }),
    );
  });
});
