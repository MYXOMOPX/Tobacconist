/**
 * Telling a misspelled flavour from a different one.
 *
 * Vision misreads letters and vendors mistype, so the same flavour arrives as
 * "FRUITTALLLITY", "Fruitality " or "FRUITАLITY" (with a Cyrillic А). Comparison
 * goes through a normalised key and the Damerau–Levenshtein distance, which
 * counts a swap of two neighbouring letters as one edit — the usual typo.
 */

// Cyrillic letters that look like Latin ones. Vision and keyboards mix them up,
// and the two spellings must land on the same key.
const LOOKALIKES: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
};

export function normalizeFlavorName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[а-яё]/g, (ch) => LOOKALIKES[ch] ?? ch)
    .replace(/[^a-z0-9а-я]/g, '');
}

/** Optimal-string-alignment distance: insert, delete, substitute, swap neighbours. */
export function damerauLevenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) d[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * How many edits still count as "the same flavour". Short names get none: one
 * letter turns "MINT" into "MIST", a different flavour, not a typo.
 */
export function maxTypoDistance(length: number): number {
  if (length <= 4) return 0;
  if (length <= 8) return 1;
  // Long names carry proportionally more noise: ~30% of the letters.
  return Math.max(2, Math.floor(length * 0.3));
}

export type FlavorMatch =
  | { kind: 'exact'; name: string }
  | { kind: 'near'; name: string; distance: number }
  /** Several equally close candidates: not safe to pick one without a judge. */
  | { kind: 'ambiguous'; names: string[]; distance: number }
  | { kind: 'none' };

/** Finds what `name` most likely is among `candidates` (already-accepted spellings). */
export function matchFlavor(name: string, candidates: readonly string[]): FlavorMatch {
  const key = normalizeFlavorName(name);
  if (!key) return { kind: 'none' };

  let best: { name: string; distance: number }[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const candidateKey = normalizeFlavorName(candidate);
    if (!candidateKey || seen.has(candidate)) continue;
    seen.add(candidate);
    if (candidateKey === key) return { kind: 'exact', name: candidate };

    const distance = damerauLevenshtein(key, candidateKey);
    if (distance > maxTypoDistance(Math.min(key.length, candidateKey.length))) continue;
    if (best.length === 0 || distance < best[0].distance) best = [{ name: candidate, distance }];
    else if (distance === best[0].distance) best.push({ name: candidate, distance });
  }

  if (best.length === 0) return { kind: 'none' };
  if (best.length === 1) return { kind: 'near', ...best[0] };
  return { kind: 'ambiguous', names: best.map((b) => b.name), distance: best[0].distance };
}

export type ResolvedEntry = {
  name: string;
  available: boolean;
  /** What was read off the picture, when it was corrected to another spelling. */
  originalName?: string;
  /**
   * The match was a guess: close to several known flavours at once (left as
   * read), or several edits away (already applied). A judge confirms or vetoes
   * it with these candidates.
   */
  checkWith?: string[];
};

/**
 * Snaps every entry to a spelling that is already known, or to an earlier entry
 * of the same batch, and merges the duplicates this produces. Known spellings
 * win (they are the authority), then the order of appearance.
 */
export function resolveEntries(
  entries: readonly { name: string; available: boolean }[],
  known: readonly string[]
): ResolvedEntry[] {
  const result: ResolvedEntry[] = [];
  const spellings = [...known];

  for (const entry of entries) {
    const match = matchFlavor(entry.name, spellings);

    if (match.kind === 'exact' || match.kind === 'near') {
      const target = result.find((r) => r.name === match.name);
      if (target) {
        // A flavour listed twice is in stock if either listing says so.
        target.available = target.available || entry.available;
        if (match.kind === 'near' && !target.originalName) target.originalName = entry.name;
        continue;
      }
      result.push({
        name: match.name,
        available: entry.available,
        ...(match.kind === 'near' || entry.name !== match.name ? { originalName: entry.name } : {}),
        ...(match.kind === 'near' && match.distance >= 2 ? { checkWith: [match.name] } : {}),
      });
      continue;
    }

    const resolved: ResolvedEntry = { name: entry.name, available: entry.available };
    if (match.kind === 'ambiguous') resolved.checkWith = match.names;
    result.push(resolved);
    spellings.push(entry.name);
  }
  return result;
}
