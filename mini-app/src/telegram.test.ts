import { describe, it, expect, afterEach, vi } from 'vitest';
import { getInitData } from './telegram';

describe('getInitData', () => {
  afterEach(() => {
    delete (window as any).Telegram;
  });

  it('throws when the Telegram WebApp SDK is not present', () => {
    expect(() => getInitData()).toThrow(/Telegram WebApp SDK/);
  });

  it('returns initData and calls ready/expand when the SDK is present', () => {
    const ready = vi.fn();
    const expand = vi.fn();
    (window as any).Telegram = { WebApp: { initData: 'abc123', ready, expand } };
    expect(getInitData()).toBe('abc123');
    expect(ready).toHaveBeenCalled();
    expect(expand).toHaveBeenCalled();
  });
});
