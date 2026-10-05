import { describe, expect, it } from 'vitest';
import { GeminiError, classifyGeminiError } from './errors';

describe('classifyGeminiError', () => {
  const code = (message: string) => classifyGeminiError(new Error(message)).code;

  it('recognises the quota being used up', () => {
    expect(code('[429 Too Many Requests] You exceeded your current quota')).toBe('quota');
    expect(code('RESOURCE_EXHAUSTED')).toBe('quota');
  });
  it('recognises a bad key, a retired model, an overload and a timeout', () => {
    expect(code('[403 Forbidden] API key not valid')).toBe('auth');
    expect(code('[404 Not Found] models/gemini-1.5-flash is not found')).toBe('model');
    expect(code('[503 Service Unavailable] The model is overloaded')).toBe('overloaded');
    expect(code('request timeout')).toBe('timeout');
  });
  it('keeps the provider text after the explanation and sets an HTTP status', () => {
    const err = classifyGeminiError(new Error('[429] quota'));
    expect(err.message).toContain('Исчерпан лимит');
    expect(err.message).toContain('[429] quota');
    expect(err.statusCode).toBe(429);
  });
  it('passes its own errors through and falls back to unknown', () => {
    const own = new GeminiError('agy_missing');
    expect(classifyGeminiError(own)).toBe(own);
    expect(code('something strange')).toBe('unknown');
  });
});
