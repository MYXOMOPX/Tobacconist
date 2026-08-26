import type { GeminiClient } from './client';

const PROMPT = `You are reading a photo of a tobacco vendor's flavor availability list for one brand and one pack weight. List every flavor name you can read. A flavor is UNAVAILABLE if its text is struck through (a line drawn through it) in the photo; otherwise it is AVAILABLE. Respond with ONLY a JSON array, no prose, no markdown fences, in this exact shape: [{"name": string, "available": boolean}, ...]`;

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

export async function parseAvailabilityImage(
  client: GeminiClient,
  params: { imageBase64: string; mimeType: string }
): Promise<{ name: string; available: boolean }[]> {
  const raw = await client.generateFromImage({
    imageBase64: params.imageBase64,
    mimeType: params.mimeType,
    prompt: PROMPT,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    throw new Error('failed to parse Gemini availability response: not valid JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('failed to parse Gemini availability response: expected a JSON array');
  }

  const entries = parsed.map((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as any).name !== 'string' ||
      typeof (item as any).available !== 'boolean'
    ) {
      throw new Error(
        'failed to parse Gemini availability response: entry missing name/available fields'
      );
    }
    return { name: (item as any).name as string, available: (item as any).available as boolean };
  });

  return entries;
}
