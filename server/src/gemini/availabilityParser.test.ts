import { describe, it, expect, vi } from 'vitest';
import type { GeminiClient } from './client';
import { parseAvailabilityImage } from './availabilityParser';

function mockClient(responseText: string): GeminiClient {
  return { generateFromImage: async () => responseText };
}

const image = { imageBase64: 'x', mimeType: 'image/jpeg' };

describe('parseAvailabilityImage', () => {
  it('reads the brand, the weight and the flavours off one screenshot', async () => {
    const client = mockClient(
      JSON.stringify({
        brand: 'DARKSIDE CORE',
        grams: 250,
        flavors: [
          { name: 'CyberKiwi', available: true },
          { name: 'Mango', available: false },
        ],
      })
    );

    expect(await parseAvailabilityImage(client, image)).toEqual({
      brand: 'DARKSIDE CORE',
      grams: 250,
      flavors: [
        { name: 'CyberKiwi', available: true },
        { name: 'Mango', available: false },
      ],
    });
  });

  it('accepts a cropped screenshot that shows neither brand nor weight', async () => {
    const client = mockClient(
      JSON.stringify({ brand: null, grams: null, flavors: [{ name: 'Mango', available: true }] })
    );

    expect(await parseAvailabilityImage(client, image)).toEqual({
      brand: null,
      grams: null,
      flavors: [{ name: 'Mango', available: true }],
    });
  });

  it('treats a blank brand as not detected rather than as a name', async () => {
    const client = mockClient(JSON.stringify({ brand: '   ', grams: 250, flavors: [] }));
    expect((await parseAvailabilityImage(client, image)).brand).toBeNull();
  });

  it('trims flavour names and drops empty ones', async () => {
    const client = mockClient(
      JSON.stringify({
        brand: 'DarkSide',
        grams: 100,
        flavors: [
          { name: '  Ice Storm  ', available: true },
          { name: '', available: true },
        ],
      })
    );

    expect((await parseAvailabilityImage(client, image)).flavors).toEqual([
      { name: 'Ice Storm', available: true },
    ]);
  });

  it('strips a markdown code fence around the JSON', async () => {
    const client = mockClient('```json\n{"brand":"DarkSide","grams":250,"flavors":[{"name":"Mango","available":true}]}\n```');
    expect((await parseAvailabilityImage(client, image)).flavors).toEqual([
      { name: 'Mango', available: true },
    ]);
  });

  it('throws a descriptive error on an unparseable response', async () => {
    const client = { generateFromImage: vi.fn().mockResolvedValue('sorry, I cannot help with that') };
    await expect(parseAvailabilityImage(client, image)).rejects.toThrow('not valid JSON');
    expect(client.generateFromImage).toHaveBeenCalledTimes(2);
  });

  it('retries once when the first agy response is not JSON', async () => {
    const client = {
      generateFromImage: vi.fn()
        .mockResolvedValueOnce('I found the flavors, but the response is incomplete')
        .mockResolvedValueOnce('{"brand":"MUSTHAVE","grams":250,"flavors":[{"name":"Alova","available":true}]}'),
    };
    expect(await parseAvailabilityImage(client, image)).toEqual({
      brand: 'MUSTHAVE', grams: 250, flavors: [{ name: 'Alova', available: true }],
    });
    expect(client.generateFromImage).toHaveBeenCalledTimes(2);
  });

  it('rejects the old array-shaped response instead of silently reading nothing', async () => {
    const client = mockClient(JSON.stringify([{ name: 'Mango', available: true }]));
    await expect(parseAvailabilityImage(client, image)).rejects.toThrow('expected a JSON object');
  });

  it('rejects an entry that is missing its availability flag', async () => {
    const client = mockClient(JSON.stringify({ brand: null, grams: null, flavors: [{ name: 'Mango' }] }));
    await expect(parseAvailabilityImage(client, image)).rejects.toThrow('missing name/available');
  });
});
