import type { Db } from '../db/client.js';
import { normalizeFlavorName } from '../domain/flavorMatch.js';
import type { GeminiClient } from './client.js';
import {
  findDuplicateClusters,
  proposeMerges,
  type DuplicateGroup,
  type FlavorRef,
} from '../domain/flavorMerge.js';

const PROMPT = `You are cleaning the flavor list of one tobacco brand. Each case is a set of names that look alike. Decide which of them are the SAME flavor spelled differently (OCR mistakes, vendor typos, letter case, Latin/Cyrillic lookalikes). Names that are genuinely different flavors must stay apart, even if similar (e.g. "Mint" and "Mist"). Pick the correct spelling as "canonical" (exactly one of the names in the case) and list the others that are misspellings of it in "same". Respond with ONLY JSON: {"answers": [{"id": number, "canonical": string|null, "same": [string]}]} — use canonical null when none of them are duplicates.`;

type Answer = { id: number; canonical: string | null; same: string[] };

function parseAnswers(raw: string): Answer[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const parsed: unknown = JSON.parse((fenced ? fenced[1] : raw).trim());
  const answers = (parsed as { answers?: unknown } | null)?.answers;
  if (!Array.isArray(answers)) throw new Error('answers must be an array');
  return answers.filter(
    (a): a is Answer =>
      typeof a === 'object' && a !== null && typeof a.id === 'number' && Array.isArray(a.same)
  );
}

/**
 * What "find duplicates and typos" would merge in one brand, without merging it.
 * Exact twins (same name once normalised) go straight in; clusters held together
 * only by the typo-distance rule are put to the model, which may split them or
 * decline. If the model is unreachable only the safe-distance proposal is shown,
 * and the admin confirms it either way.
 */
export async function reviewDuplicates(
  db: Db,
  client: GeminiClient,
  brand: { id: number; name: string }
): Promise<{ groups: DuplicateGroup[]; judgedByAi: boolean }> {
  // Without the model only the safe distance is trusted; with it, the wide net
  // is cast and the model decides which of the catches are real.
  const safeClusters = await findDuplicateClusters(db, brand.id);
  const safe = await proposeMerges(db, safeClusters);
  if (!client.generateText) return { groups: safe, judgedByAi: false };

  const clusters = await findDuplicateClusters(db, brand.id, { wide: true });
  const proposals = await proposeMerges(db, clusters);

  const doubtful = proposals
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => group.fuzzy);
  if (doubtful.length === 0) return { groups: proposals, judgedByAi: false };

  const cases = doubtful.map(({ index }, id) => ({ id, names: clusters[index].map((m) => m.name) }));
  let answers: Answer[];
  try {
    answers = parseAnswers(
      await client.generateText({ prompt: `${PROMPT}\n\nBrand: ${brand.name}\nCases: ${JSON.stringify(cases)}` })
    );
  } catch {
    return { groups: safe, judgedByAi: false };
  }

  const result: DuplicateGroup[] = proposals.filter((group) => !group.fuzzy);
  doubtful.forEach(({ group, index }, id) => {
    const members: FlavorRef[] = clusters[index];
    const answer = answers.find((a) => a.id === id);
    // No answer for a case: take only what the safe distance already vouched for.
    if (!answer) return;
    // The model may echo a name in another case; names are compared the way the
    // rest of the matching does, ignoring case and punctuation.
    const sameKey = (a: string, b: string) => normalizeFlavorName(a) === normalizeFlavorName(b);
    const keep = answer.canonical ? members.find((m) => sameKey(m.name, answer.canonical!)) : undefined;
    const duplicates = members.filter(
      (m) => m !== keep && answer.same.some((name) => sameKey(name, m.name))
    );
    if (keep && duplicates.length > 0) {
      result.push({ keep, duplicates, fuzzy: true });
    }
    // canonical null, or nothing to merge: the model says these are different flavours.
  });
  return { groups: result, judgedByAi: true };
}
