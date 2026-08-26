// server/src/gemini/availabilityParser.test.ts
import { describe, it, expect } from 'vitest';
import type { GeminiClient } from './client';
import { parseAvailabilityImage } from './availabilityParser';

function mockClient(responseText: string): GeminiClient {
  return { generateFromImage: async () => responseText };
}

describe('parseAvailabilityImage', () => {
  it('parses a clean JSON array response', async () => {
    const client = mockClient(
      JSON.stringify([
        { name: 'CyberKiwi', available: true },
        { name: 'Mango', available: false },
      ])
    );
    const result = await parseAvailabilityImage(client, {
      imageBase64: 'x',
      mimeType: 'image/jpeg',
    });
    expect(result).toEqual([
      { name: 'CyberKiwi', available: true },
      { name: 'Mango', available: false },
    ]);
  });

  it('strips a markdown code fence around the JSON', async () => {
    const client = mockClient('```json\n[{"name":"Mango","available":true}]\n```');
    const result = await parseAvailabilityImage(client, {
      imageBase64: 'x',
      mimeType: 'image/jpeg',
    });
    expect(result).toEqual([{ name: 'Mango', available: true }]);
  });

  it('throws a descriptive error on unparseable response', async () => {
    const client = mockClient('sorry, I cannot help with that');
    await expect(
      parseAvailabilityImage(client, { imageBase64: 'x', mimeType: 'image/jpeg' })
    ).rejects.toThrow(/failed to parse Gemini availability response/i);
  });

  it('throws when entries are missing required fields', async () => {
    const client = mockClient(JSON.stringify([{ name: 'Mango' }]));
    await expect(
      parseAvailabilityImage(client, { imageBase64: 'x', mimeType: 'image/jpeg' })
    ).rejects.toThrow(/failed to parse Gemini availability response/i);
  });
});
