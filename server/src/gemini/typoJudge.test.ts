import { describe, expect, it } from 'vitest';
import { judgeDoubtfulEntries } from './typoJudge';
import type { GeminiClient } from './client';
import type { ResolvedEntry } from '../domain/flavorMatch';

const doubtful: ResolvedEntry[] = [
  { name: 'FRUITALITY', available: true, originalName: 'FRUITTALLLITY', checkWith: ['FRUITALITY'] },
  { name: 'MANGO', available: false },
];

function client(text: string | Error): GeminiClient {
  return {
    generateFromImage: async () => '',
    generateText: async () => {
      if (text instanceof Error) throw text;
      return text;
    },
  };
}

describe('judgeDoubtfulEntries', () => {
  it('confirms a guess and keeps the original for the tooltip', async () => {
    const out = await judgeDoubtfulEntries(
      client('{"answers":[{"id":0,"same":true,"name":"FRUITALITY"}]}'),
      'Brand',
      doubtful
    );
    expect(out[0]).toEqual({ name: 'FRUITALITY', available: true, originalName: 'FRUITTALLLITY' });
    expect(out[1]).toEqual({ name: 'MANGO', available: false });
  });

  it('vetoes a guess the model calls a different flavour', async () => {
    const out = await judgeDoubtfulEntries(client('{"answers":[{"id":0,"same":false,"name":null}]}'), 'Brand', doubtful);
    expect(out[0]).toEqual({ name: 'FRUITTALLLITY', available: true });
  });

  it('ignores a name the model made up', async () => {
    const out = await judgeDoubtfulEntries(
      client('{"answers":[{"id":0,"same":true,"name":"SOMETHING ELSE"}]}'),
      'Brand',
      doubtful
    );
    expect(out[0].name).toBe('FRUITALITY');
  });

  it('keeps the algorithm result when the call fails', async () => {
    const out = await judgeDoubtfulEntries(client(new Error('503')), 'Brand', doubtful);
    expect(out[0]).toEqual({ name: 'FRUITALITY', available: true, originalName: 'FRUITTALLLITY' });
  });
});
