import { describe, it, expect, afterEach, vi } from 'vitest';
import { authHeaders, orderFromLaunch } from './telegram';

describe('authHeaders', () => {
  afterEach(() => {
    delete (window as any).Telegram;
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('signs with init data and wakes the SDK when running inside Telegram', () => {
    const ready = vi.fn();
    const expand = vi.fn();
    (window as any).Telegram = { WebApp: { initData: 'abc123', ready, expand } };
    expect(authHeaders()).toEqual({ 'X-Telegram-Init-Data': 'abc123' });
    expect(ready).toHaveBeenCalled();
    expect(expand).toHaveBeenCalled();
  });

  it('asks for a name outside Telegram and remembers it', () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('  Ann  ');
    expect(authHeaders()).toEqual({ 'X-Dev-User': 'Ann' });
    expect(authHeaders()).toEqual({ 'X-Dev-User': 'Ann' });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('asks for a name when the SDK loaded but Telegram never launched the page', () => {
    // telegram-web-app.js is on the page in a plain browser too — with empty initData.
    const ready = vi.fn();
    (window as any).Telegram = { WebApp: { initData: '', ready, expand: vi.fn() } };
    vi.spyOn(window, 'prompt').mockReturnValue('Ann');
    expect(authHeaders()).toEqual({ 'X-Dev-User': 'Ann' });
    expect(ready).not.toHaveBeenCalled();
  });

  it('refuses to guess when the name is left empty', () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    expect(() => authHeaders()).toThrow(/Без имени/);
  });
});

describe('orderFromLaunch', () => {
  afterEach(() => {
    delete (window as any).Telegram;
    window.history.replaceState({}, '', '/');
  });

  /** A direct link delivers startapp as start_param, never as a query string. */
  it('reads the order out of the direct link start parameter', () => {
    (window as any).Telegram = {
      WebApp: { initData: 'x', initDataUnsafe: { start_param: 'order_42' }, ready() {}, expand() {} },
    };
    expect(orderFromLaunch()).toBe(42);
  });

  it('still accepts ?order= for a page opened straight in a browser', () => {
    window.history.replaceState({}, '', '/?order=7');
    expect(orderFromLaunch()).toBe(7);
  });

  it('ignores a start parameter that is not an order', () => {
    (window as any).Telegram = {
      WebApp: { initData: 'x', initDataUnsafe: { start_param: 'nonsense' }, ready() {}, expand() {} },
    };
    expect(orderFromLaunch()).toBeNull();
  });

  it('is null when nothing pointed at an order', () => {
    expect(orderFromLaunch()).toBeNull();
  });
});
