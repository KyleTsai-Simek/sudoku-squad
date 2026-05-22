import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * Stream a CSV file row-by-row as plain objects keyed by header name.
 *
 * Kaggle sudoku CSVs are uniform: 81-char strings for puzzle/solution, no
 * embedded commas, no quoting. We don't need a full CSV parser; a per-line
 * split on `,` is correct and ~10x faster than pulling in `csv-parse`.
 *
 * If the file ever does carry commas/quotes (a non-Kaggle drop), switch this
 * out for a real parser rather than papering over with regex.
 */
export async function* readCsvRows(
  path: string,
): AsyncIterable<Record<string, string>> {
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let header: string[] | null = null;
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(',');
    if (header === null) {
      header = parts.map((s) => s.trim().toLowerCase());
      continue;
    }
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      row[header[i]!] = parts[i] ?? '';
    }
    yield row;
  }
}
