import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGeminiClient, DEFAULT_GEMINI_MODEL } from './client';

const generateContent = vi.fn();
const getGenerativeModel = vi.fn(() => ({ generateContent }));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel = getGenerativeModel;
  },
}));

const IMAGE = { imageBase64: 'AAAA', mimeType: 'image/png', prompt: 'read it' };

function ok(text: string) {
  return { response: { text: () => text } };
}

beforeEach(() => {
  generateContent.mockReset();
  getGenerativeModel.mockClear();
});

describe('createGeminiClient', () => {
  it('uses the configured model, so a retired id is an env change', () => {
    createGeminiClient('key', 'gemini-9-flash');
    expect(getGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-9-flash' })
    );
  });

  it('falls back to a current model id', () => {
    createGeminiClient('key');
    expect(getGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: DEFAULT_GEMINI_MODEL })
    );
  });

  it('returns the model text', async () => {
    generateContent.mockResolvedValue(ok('{"brand":null}'));
    const client = createGeminiClient('key', DEFAULT_GEMINI_MODEL, async () => {});
    expect(await client.generateFromImage(IMAGE)).toBe('{"brand":null}');
  });

  it('retries a 503, which the API returns under load often enough to matter', async () => {
    generateContent
      .mockRejectedValueOnce(new Error('[503 Service Unavailable] model is overloaded'))
      .mockResolvedValueOnce(ok('done'));
    const sleep = vi.fn(async () => {});

    const client = createGeminiClient('key', DEFAULT_GEMINI_MODEL, sleep);

    expect(await client.generateFromImage(IMAGE)).toBe('done');
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('gives up on a 404 immediately — a wrong model id will not fix itself', async () => {
    generateContent.mockRejectedValue(new Error('[404 Not Found] models/gemini-1.5-flash is not found'));
    const client = createGeminiClient('key', DEFAULT_GEMINI_MODEL, async () => {});

    await expect(client.generateFromImage(IMAGE)).rejects.toThrow('404');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('surfaces the last error when the retries run out', async () => {
    generateContent.mockRejectedValue(new Error('[503] still overloaded'));
    const client = createGeminiClient('key', DEFAULT_GEMINI_MODEL, async () => {});

    await expect(client.generateFromImage(IMAGE)).rejects.toThrow('503');
    expect(generateContent).toHaveBeenCalledTimes(4);
  });
});
