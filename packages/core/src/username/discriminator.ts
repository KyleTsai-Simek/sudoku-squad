/**
 * Username base validation + Discord-style discriminator allocation
 * ([DECISIONS #0043]). Pure and self-contained (no imports) so the Deno
 * `set-username` Edge Function can import this exact module — single source of
 * truth, property-tested here in core.
 *
 * A username is a `base` (shared across players) plus an optional numeric
 * `discriminator`. The bare base is preferred; on collision a discriminator is
 * drawn at random from the smallest non-full width (4 digits → 5 → …).
 */

export const MIN_USERNAME_LEN = 3;
export const MAX_USERNAME_LEN = 20;

/** Allowed base characters: letters, numbers, space, hyphen, underscore. */
const BASE_RE = /^[A-Za-z0-9 _-]+$/;

/**
 * Escalating discriminator widths. The bare base (no discriminator) is always
 * tried before any of these. `[1000,9999]` is the 4-digit space, etc.
 */
export const DISCRIMINATOR_RANGES: ReadonlyArray<readonly [number, number]> = [
  [1000, 9999],
  [10000, 99999],
  [100000, 999999],
  [1000000, 9999999],
];

/** Trim and collapse internal whitespace. Preserves the caller's casing. */
export function normalizeBase(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

/** Returns an error message if the base is invalid, else null. */
export function validateBase(base: string): string | null {
  if (base.length < MIN_USERNAME_LEN) {
    return `username must be at least ${MIN_USERNAME_LEN} characters`;
  }
  if (base.length > MAX_USERNAME_LEN) {
    return `username must be at most ${MAX_USERNAME_LEN} characters`;
  }
  if (!BASE_RE.test(base)) {
    return 'username may only contain letters, numbers, spaces, hyphens, and underscores';
  }
  return null;
}

/**
 * Pick a free discriminator given the set already used for a base. Walks the
 * widths in order, returning a random free value from the first non-full width.
 * Returns null only if every width is exhausted (practically impossible).
 *
 * `rand` is injectable for deterministic tests; defaults to Math.random.
 */
export function pickDiscriminator(
  used: ReadonlySet<number>,
  rand: () => number = Math.random,
): number | null {
  for (const [lo, hi] of DISCRIMINATOR_RANGES) {
    const size = hi - lo + 1;
    let usedInRange = 0;
    for (const d of used) if (d >= lo && d <= hi) usedInRange++;
    if (usedInRange >= size) continue; // full → widen
    for (let i = 0; i < 50; i++) {
      const d = lo + Math.floor(rand() * size);
      if (!used.has(d)) return d;
    }
    // Dense range: deterministic scan for a free slot.
    for (let d = lo; d <= hi; d++) if (!used.has(d)) return d;
  }
  return null;
}

/** The display string for a (base, discriminator) pair: `base` or `base#NNNN`. */
export function displayUsername(base: string, discriminator: number | null): string {
  return discriminator === null ? base : `${base}#${discriminator}`;
}
