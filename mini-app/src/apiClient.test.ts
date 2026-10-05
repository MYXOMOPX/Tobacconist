import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./telegram', () => ({ authHeaders: () => ({ 'X-Telegram-Init-Data': 'fake-init-data' }) }));

import { api } from './apiClient';

describe('api client', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('sends the init data header and parses JSON on success', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hello: 'world' }),
    });
    const result = await api.get('/foo');
    expect(result).toEqual({ hello: 'world' });
    const [, opts] = (global.fetch as any).mock.calls[0];
    expect(opts.headers['X-Telegram-Init-Data']).toBe('fake-init-data');
  });

  it('sends a JSON content type only when there is a body', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await api.post('/no-body');
    await api.post('/with-body', { a: 1 });
    const [, bodyless] = (global.fetch as any).mock.calls[0];
    const [, withBody] = (global.fetch as any).mock.calls[1];
    expect(bodyless.headers['Content-Type']).toBeUndefined();
    expect(withBody.headers['Content-Type']).toBe('application/json');
  });

  it('throws with the server error message on failure', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'bad request' }),
    });
    await expect(api.get('/foo')).rejects.toThrow('bad request');
  });
});
