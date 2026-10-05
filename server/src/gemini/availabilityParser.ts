import type { GeminiClient } from './client.js';
import { GeminiError } from './errors.js';

/**
 * Reads a vendor's stock screenshot. The brand and the pack weight are usually
 * printed on the screenshot itself, so the admin should not have to retype what
 * the picture already says (spec §4) — but both come back nullable, because a
 * cropped screenshot may show neither.
 */
const PROMPT = `You are reading a screenshot of a tobacco vendor's stock list. Extract the brand name, the pack weight in grams, and every flavor in the list. A flavor is UNAVAILABLE if its text is struck through (a line drawn through it) or clearly marked as out of stock; otherwise it is AVAILABLE. The weight may be written as "250 гр", "250g", "100 г" or similar — return it as a plain number of grams. Return null for brand or grams if the screenshot does not show them. Respond with ONLY JSON in this exact shape: {"brand": string|null, "grams": number|null, "flavors": [{"name": string, "available": boolean}]}`;

export type ParsedAvailability = {
  brand: string | null;
  grams: number | null;
  flavors: { name: string; available: boolean }[];
};

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

function fail(reason: string): never {
  throw new GeminiError('bad_response', reason);
}

export async function parseAvailabilityImage(
  client: GeminiClient,
  params: { imageBase64: string; mimeType: string }
): Promise<ParsedAvailability> {
  const raw = await client.generateFromImage({
    imageBase64: params.imageBase64,
    mimeType: params.mimeType,
    prompt: PROMPT,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    fail('not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail('expected a JSON object');
  }

  const { brand, grams, flavors } = parsed as Record<string, unknown>;

  if (brand !== null && brand !== undefined && typeof brand !== 'string') fail('brand must be a string or null');
  if (grams !== null && grams !== undefined && typeof grams !== 'number') fail('grams must be a number or null');
  if (!Array.isArray(flavors)) fail('flavors must be an array');

  const entries = flavors.map((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as { name?: unknown }).name !== 'string' ||
      typeof (item as { available?: unknown }).available !== 'boolean'
    ) {
      fail('entry missing name/available fields');
    }
    const entry = item as { name: string; available: boolean };
    return { name: entry.name.trim(), available: entry.available };
  });

  return {
    brand: typeof brand === 'string' && brand.trim() ? brand.trim() : null,
    grams: typeof grams === 'number' && Number.isFinite(grams) ? Math.round(grams) : null,
    flavors: entries.filter((entry) => entry.name.length > 0),
  };
}
