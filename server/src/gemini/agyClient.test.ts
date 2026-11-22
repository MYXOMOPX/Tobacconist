import { describe, expect, it, vi } from 'vitest';
import { createAgyClient, DEFAULT_AGY_MODEL, type AgyRunner } from './agyClient';

const reply = (body: object) => JSON.stringify({ status: 'SUCCESS', ...body });

describe('createAgyClient', () => {
  it('runs agy read-only with the model and returns its response', async () => {
    const run = vi.fn<AgyRunner>(async () => ({ stdout: reply({ response: '{"ok":true}' }), stderr: '' }));
    const client = createAgyClient({ run, model: 'gemini-3.8-flash-high' });

    expect(await client.generateText!({ prompt: 'hi' })).toBe('{"ok":true}');
    const [command, args] = run.mock.calls[0];
    expect(command).toBe('agy');
    expect(args).toEqual(expect.arrayContaining(['--model', 'gemini-3.8-flash-high', '--mode', 'plan', 'json']));
    expect(args[args.indexOf('--print') + 1]).toBe('hi');
  });

  it('reports the CLI envelope and stderr when agy succeeds with an empty response', async () => {
    const onEmptyResponse = vi.fn();
    const stdout = reply({ response: '', extra: 'no final message' });
    const run: AgyRunner = async () => ({ stdout, stderr: 'warning from agy' });
    const client = createAgyClient({ run, onEmptyResponse });

    expect(await client.generateText!({ prompt: 'hi' })).toBe('');
    expect(onEmptyResponse).toHaveBeenCalledWith(expect.objectContaining({
      stdout,
      stderr: 'warning from agy',
      status: 'SUCCESS',
      keys: ['status', 'response', 'extra'],
    }));
  });

  it('writes an empty-response diagnostic to server logs by default', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const run: AgyRunner = async () => ({ stdout: reply({ response: '', private: 'sensitive model data' }), stderr: 'warning from agy' });
      await createAgyClient({ run }).generateText!({ prompt: 'hi' });
      expect(log).toHaveBeenCalledWith(expect.stringContaining('[agy] empty model response'));
      expect(log.mock.calls[0][0]).toContain('stderrLength');
      expect(log.mock.calls[0][0]).not.toContain('warning from agy');
      expect(log.mock.calls[0][0]).not.toContain('sensitive model data');
    } finally {
      log.mockRestore();
    }
  });

  it('includes bounded raw CLI output only when explicitly enabled', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const extras = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`private_${i}_${'x'.repeat(100)}`, i]));
      const run: AgyRunner = async () => ({ stdout: reply({ response: '', ...extras }), stderr: 'warning from agy' });
      await createAgyClient({ run, debugOutput: true }).generateText!({ prompt: 'hi' });
      const line = String(log.mock.calls[0][0]);
      expect(line).toContain('warning from agy');
      expect(line).toContain('keyCount');
      expect(line.length).toBeLessThan(5000);
    } finally {
      log.mockRestore();
    }
  });

  it('hands an image over as a file the prompt points at', async () => {
    const run = vi.fn<AgyRunner>(async () => ({ stdout: reply({ response: 'x' }), stderr: '' }));
    await createAgyClient({ run }).generateFromImage({ imageBase64: 'AAAA', mimeType: 'image/png', prompt: 'read it' });
    const [, args] = run.mock.calls[0];
    expect(args[args.indexOf('--print') + 1]).toMatch(/screenshot\.png".*read it/s);
    expect(args[args.indexOf('--model') + 1]).toBe(DEFAULT_AGY_MODEL);
  });

  it('says so when agy is not installed', async () => {
    const run: AgyRunner = async () => {
      throw Object.assign(new Error('spawn agy ENOENT'), { code: 'ENOENT' });
    };
    await expect(createAgyClient({ run }).generateText!({ prompt: 'x' })).rejects.toThrow('agy');
  });

  it('turns a quota refusal and an unknown model into explained errors', async () => {
    const quota: AgyRunner = async () => {
      throw Object.assign(new Error('exit 1'), { stderr: 'error: quota exceeded (429)', stdout: '' });
    };
    await expect(createAgyClient({ run: quota }).generateText!({ prompt: 'x' })).rejects.toThrow('Исчерпан лимит');

    const model: AgyRunner = async () => {
      throw Object.assign(new Error('exit 1'), { stderr: 'invalid model selection: not recognized', stdout: '' });
    };
    await expect(createAgyClient({ run: model }).generateText!({ prompt: 'x' })).rejects.toThrow('GEMINI_MODEL');
  });

  it('reports a timeout and a garbled reply', async () => {
    const slow: AgyRunner = async () => {
      throw Object.assign(new Error('killed'), { killed: true });
    };
    await expect(createAgyClient({ run: slow }).generateText!({ prompt: 'x' })).rejects.toThrow('слишком долго');
    const garbled: AgyRunner = async () => ({ stdout: 'oops', stderr: '' });
    await expect(createAgyClient({ run: garbled }).generateText!({ prompt: 'x' })).rejects.toThrow('формате');
  });
});
