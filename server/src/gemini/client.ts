import { GoogleGenerativeAI } from '@google/generative-ai';

export interface GeminiClient {
  generateFromImage(params: { imageBase64: string; mimeType: string; prompt: string }): Promise<string>;
  /** Text only, no picture — used for judging doubtful spellings. */
  generateText?(params: { prompt: string }): Promise<string>;
}

/**
 * Google retires model ids on its own schedule — `gemini-1.5-flash` started
 * answering 404 while this app was live. The id therefore lives in config, so a
 * retirement is an env change and a restart rather than a code release.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/** The API returns 503 under load often enough that a single attempt is not reliable. */
const RETRY_DELAYS_MS = [500, 2000, 5000];

function isTransient(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\b(429|500|502|503|504)\b|overloaded|unavailable|timeout|ETIMEDOUT|ECONNRESET/i.test(message);
}

export function createGeminiClient(
  apiKey: string,
  modelName: string = DEFAULT_GEMINI_MODEL,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): GeminiClient {
  // Dev mode makes the key optional, so the server has to boot without one. Sent
  // anyway, an empty key comes back as Google's "[403] Method doesn't allow
  // unregistered callers", which says nothing about what to do — say it here.
  if (!apiKey) {
    return {
      async generateFromImage() {
        throw new Error('no GEMINI_API_KEY is set, so screenshots cannot be recognised');
      },
      async generateText() {
        throw new Error('no GEMINI_API_KEY is set, so spellings cannot be judged');
      },
    };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    // Ask for JSON directly instead of hoping the prose comes back parseable.
    generationConfig: { responseMimeType: 'application/json' },
  });

  async function withRetry(call: () => Promise<string>): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        return await call();
      } catch (err) {
        lastError = err;
        if (!isTransient(err) || attempt === RETRY_DELAYS_MS.length) break;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
    throw lastError;
  }

  return {
    generateFromImage: ({ imageBase64, mimeType, prompt }) =>
      withRetry(async () => {
        const result = await model.generateContent([
          { inlineData: { data: imageBase64, mimeType } },
          { text: prompt },
        ]);
        return result.response.text();
      }),
    generateText: ({ prompt }) =>
      withRetry(async () => (await model.generateContent([{ text: prompt }])).response.text()),
  };
}
