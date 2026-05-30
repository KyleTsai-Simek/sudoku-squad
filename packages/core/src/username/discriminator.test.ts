import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DISCRIMINATOR_RANGES,
  displayUsername,
  normalizeBase,
  pickDiscriminator,
  validateBase,
} from './discriminator';

describe('normalizeBase', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeBase('  kyle  ')).toBe('kyle');
    expect(normalizeBase('the   big   cat')).toBe('the big cat');
  });
});

describe('validateBase', () => {
  it('accepts valid names', () => {
    expect(validateBase('kyle')).toBeNull();
    expect(validateBase('brave-tiger_99')).toBeNull();
    expect(validateBase('the big cat')).toBeNull();
  });

  it('rejects too short / too long', () => {
    expect(validateBase('ab')).toMatch(/at least/);
    expect(validateBase('x'.repeat(21))).toMatch(/at most/);
  });

  it('rejects disallowed characters (including the discriminator separator)', () => {
    expect(validateBase('kyle#1234')).toMatch(/only contain/);
    expect(validateBase('joe@home')).toMatch(/only contain/);
    expect(validateBase('emoji😀')).toMatch(/only contain/);
  });
});

describe('displayUsername', () => {
  it('renders a bare base without a hash', () => {
    expect(displayUsername('kyle', null)).toBe('kyle');
  });
  it('appends #discriminator when set', () => {
    expect(displayUsername('kyle', 1234)).toBe('kyle#1234');
  });
});

describe('pickDiscriminator', () => {
  it('returns a 4-digit value when nothing is used', () => {
    const d = pickDiscriminator(new Set());
    expect(d).not.toBeNull();
    expect(d).toBeGreaterThanOrEqual(1000);
    expect(d).toBeLessThanOrEqual(9999);
  });

  it('never returns a used value', () => {
    const used = new Set([1000, 1001, 1002]);
    // Force the random draws onto the used values, so the function must fall
    // through to the deterministic scan and skip them.
    const d = pickDiscriminator(used, () => 0);
    expect(used.has(d as number)).toBe(false);
    expect(d).toBeGreaterThanOrEqual(1000);
  });

  it('widens to 5 digits when the 4-digit space is full', () => {
    const [lo, hi] = DISCRIMINATOR_RANGES[0]!;
    const full = new Set<number>();
    for (let d = lo; d <= hi; d++) full.add(d);
    const d = pickDiscriminator(full);
    expect(d).not.toBeNull();
    expect(d).toBeGreaterThanOrEqual(10000); // 5-digit width
    expect(d).toBeLessThanOrEqual(99999);
  });

  it('property: result is always free and >= 1000', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1000, max: 20000 }), { maxLength: 200 }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (usedArr, r) => {
          const used = new Set(usedArr);
          const d = pickDiscriminator(used, () => r);
          expect(d).not.toBeNull();
          expect(used.has(d as number)).toBe(false);
          expect(d as number).toBeGreaterThanOrEqual(1000);
        },
      ),
    );
  });
});
