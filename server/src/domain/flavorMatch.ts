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
 * How many edits still count as "the same flavour" with no one to ask. Short
 * names get none: one letter turns "MINT" into "MIST", a different flavour.
 * The cap is 2 because real flavours sit three edits apart ("Kashmir Lime" and
 * "Kashmir Lemon"), and merging those would be silent data loss.
 */
export function maxTypoDistance(length: number): number {
  if (length <= 4) return 0;
  if (length <= 8) return 1;
  return 2;
}

/**
 * The wider net, ~30% of the letters, for long names mangled by OCR
 * ("FRUITTALLLITY"). Too loose to trust on its own: a match this far is only a
 * question for the judge (or the admin's preview), never merged silently.
 */
export function maxDoubtfulDistance(length: number): number {
  return length < 9 ? maxTypoDistance(length) : Math.max(maxTypoDistance(length), Math.floor(length * 0.3));
}

export type FlavorMatch =
  | { kind: 'exact'; name: string }
  | { kind: 'near'; name: string; distance: number }
  /** Several equally close candidates: not safe to pick one without a judge. */
  | { kind: 'ambiguous'; names: string[]; distance: number }
  /** Beyond the safe distance but within the wide one: worth asking about. */
  | { kind: 'doubtful'; names: string[]; distance: number }
  | { kind: 'none' };

/** Finds what `name` most likely is among `candidates` (already-accepted spellings). */
export function matchFlavor(name: string, candidates: readonly string[]): FlavorMatch {
  const key = normalizeFlavorName(name);
  if (!key) return { kind: 'none' };

  let near: { name: string; distance: number }[] = [];
  let doubtful: { name: string; distance: number }[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const candidateKey = normalizeFlavorName(candidate);
    if (!candidateKey || seen.has(candidate)) continue;
    seen.add(candidate);
    if (candidateKey === key) return { kind: 'exact', name: candidate };

    const distance = damerauLevenshtein(key, candidateKey);
    const shorter = Math.min(key.length, candidateKey.length);
    if (distance <= maxTypoDistance(shorter)) {
      if (near.length === 0 || distance < near[0].distance) near = [{ name: candidate, distance }];
      else if (distance === near[0].distance) near.push({ name: candidate, distance });
    } else if (distance <= maxDoubtfulDistance(shorter)) {
      doubtful.push({ name: candidate, distance });
    }
  }

  if (near.length === 1) return { kind: 'near', ...near[0] };
  if (near.length > 1) return { kind: 'ambiguous', names: near.map((n) => n.name), distance: near[0].distance };
  if (doubtful.length > 0) {
    const closest = Math.min(...doubtful.map((d) => d.distance));
    return {
      kind: 'doubtful',
      names: doubtful.filter((d) => d.distance === closest).map((d) => d.name),
      distance: closest,
    };
  }
  return { kind: 'none' };
}

export type ResolvedEntry = {
  name: string;
  available: boolean;
  /** What was read off the picture, when it was corrected to another spelling. */
  originalName?: string;
  /**
   * Left as read, but close to these known flavours (several at once, or too
   * many edits away to trust). A judge may rename it to one of them.
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
        // A different case or punctuation is the same name, not a typo worth flagging.
        ...(match.kind === 'near' ? { originalName: entry.name } : {}),
      });
      continue;
    }

    const resolved: ResolvedEntry = { name: entry.name, available: entry.available };
    if (match.kind === 'ambiguous' || match.kind === 'doubtful') resolved.checkWith = match.names;
    result.push(resolved);
    spellings.push(entry.name);
  }
  return result;
}
