import type { GeminiClient } from './client.js';
import type { ResolvedEntry } from '../domain/flavorMatch.js';

const PROMPT = `You are checking flavor names of a tobacco brand for typos. A name was read from a vendor's screenshot and may contain an OCR mistake or the vendor's own typo. For each case decide whether it is the SAME flavor as one of the candidates (just misspelled) or a DIFFERENT flavor. Different flavors that merely look similar (e.g. "Mint" and "Mist") are NOT the same. Respond with ONLY JSON: {"answers": [{"id": number, "same": boolean, "name": string|null}]} where "name" is exactly one of the candidates when same is true, otherwise null.`;

type Answer = { id: number; same: boolean; name: string | null };

function parseAnswers(raw: string): Answer[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const parsed: unknown = JSON.parse((fenced ? fenced[1] : raw).trim());
  const answers = (parsed as { answers?: unknown } | null)?.answers;
  if (!Array.isArray(answers)) throw new Error('answers must be an array');
  return answers.filter(
    (a): a is Answer =>
      typeof a === 'object' && a !== null && typeof a.id === 'number' && typeof a.same === 'boolean'
  );
}

/**
 * Lets the model settle the doubtful spellings the distance rule could not.
 * Only entries flagged `checkWith` are sent. The answer is trusted just as far
 * as it names one of the offered candidates; anything else, or any failure of
 * the call, leaves the entries as the algorithm resolved them.
 */
export async function judgeDoubtfulEntries(
  client: GeminiClient,
  brandName: string,
  entries: ResolvedEntry[]
): Promise<ResolvedEntry[]> {
  const doubtful = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.checkWith?.length);
  if (doubtful.length === 0 || !client.generateText) return entries.map(stripFlag);

  const cases = doubtful.map(({ entry }, id) => ({
    id,
    read: entry.originalName ?? entry.name,
    candidates: entry.checkWith,
  }));

  let answers: Answer[] = [];
  try {
    answers = parseAnswers(
      await client.generateText({ prompt: `${PROMPT}\n\nBrand: ${brandName}\nCases: ${JSON.stringify(cases)}` })
    );
  } catch {
    return entries.map(stripFlag);
  }

  const out = entries.map((entry) => ({ ...entry }));
  doubtful.forEach(({ entry, index }, id) => {
    const answer = answers.find((a) => a.id === id);
    if (!answer) return;
    const read = entry.originalName ?? entry.name;
    if (answer.same && answer.name && entry.checkWith!.includes(answer.name)) {
      out[index] = { ...out[index], name: answer.name, ...(answer.name !== read ? { originalName: read } : {}) };
    } else if (!answer.same) {
      const { originalName: _dropped, ...rest } = out[index];
      out[index] = { ...rest, name: read };
    }
  });
  return mergeSameName(out.map(stripFlag));
}

/** A judged answer can land two entries on one name; keep one, in stock if either is. */
function mergeSameName(entries: ResolvedEntry[]): ResolvedEntry[] {
  const merged: ResolvedEntry[] = [];
  for (const entry of entries) {
    const twin = merged.find((m) => m.name === entry.name);
    if (twin) twin.available = twin.available || entry.available;
    else merged.push(entry);
  }
  return merged;
}

function stripFlag(entry: ResolvedEntry): ResolvedEntry {
  const { checkWith: _flag, ...rest } = entry;
  return rest;
}
