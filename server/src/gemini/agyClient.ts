import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { GeminiClient } from './client.js';
import { GeminiError, classifyGeminiError } from './errors.js';

/** A flash model the agy CLI offers; `agy models` lists what is available there. */
export const DEFAULT_AGY_MODEL = 'gemini-3.6-flash-medium';

type RunResult = { stdout: string; stderr: string };
export type AgyEmptyResponseDiagnostic = {
  stdout: string;
  stderr: string;
  status: string;
  keys: string[];
  model: string;
  durationMs: number;
};
export type AgyRunner = (
  command: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number }
) => Promise<RunResult>;

const defaultRunner: AgyRunner = (command, args, { cwd, timeoutMs }) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        // agy explains a rejected request on stdout/stderr alongside a non-zero
        // code: keep that text, it is the only explanation there is.
        if (error) reject(Object.assign(error, { stdout, stderr }));
        else resolve({ stdout, stderr });
      }
    );
  });

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/**
 * Talks to Gemini through the locally installed, signed-in `agy` CLI instead of
 * an API key — which is what gets around the key's request limits. Each call is
 * one non-interactive `agy --print` run in a throwaway directory: the picture is
 * dropped there as a file and the prompt tells the model to read it.
 */
export function createAgyClient(options: {
  command?: string;
  model?: string;
  timeoutMs?: number;
  run?: AgyRunner;
  onEmptyResponse?: (diagnostic: AgyEmptyResponseDiagnostic) => void;
  /** Include bounded stdout/stderr excerpts in the log while diagnosing agy. */
  debugOutput?: boolean;
}): GeminiClient {
  const command = options.command || 'agy';
  const model = options.model || DEFAULT_AGY_MODEL;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const run = options.run ?? defaultRunner;
  const debugOutput = options.debugOutput ?? process.env.AGY_LOG_RAW_OUTPUT === 'true';
  const onEmptyResponse = options.onEmptyResponse ?? ((diagnostic: AgyEmptyResponseDiagnostic) => {
    console.warn('[agy] empty model response ' + JSON.stringify({
      model: diagnostic.model.slice(0, 100),
      status: diagnostic.status,
      keys: diagnostic.keys.slice(0, 12).map((key) => key.slice(0, 60)),
      keyCount: diagnostic.keys.length,
      durationMs: diagnostic.durationMs,
      stdoutLength: diagnostic.stdout.length,
      stderrLength: diagnostic.stderr.length,
      ...(debugOutput ? {
        stdoutPreview: diagnostic.stdout.slice(0, 1000),
        stderrPreview: diagnostic.stderr.slice(0, 500),
      } : {}),
    }));
  });

  async function ask(prompt: string, cwd: string): Promise<string> {
    const startedAt = Date.now();
    const args = [
      '--print',
      prompt,
      '--model',
      model,
      // Read-only: the model is only to look at a picture and answer.
      '--mode',
      'plan',
      // The screenshot is already in cwd. Let agy inspect it with read_file,
      // but never let image text trigger shell commands in a headless run.
      '--settings',
      JSON.stringify({ permissions: { allow: [`read_file(${cwd})`], deny: ['command(*)'] } }),
      '--output-format',
      'json',
      '--print-timeout',
      `${Math.ceil(timeoutMs / 1000)}s`,
    ];
    let result: RunResult;
    try {
      result = await run(command, args, { cwd, timeoutMs: timeoutMs + 10_000 });
    } catch (err) {
      const failure = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean };
      if (failure.code === 'ENOENT') throw new GeminiError('agy_missing', command);
      if (failure.killed) throw new GeminiError('timeout', `agy не ответил за ${Math.round(timeoutMs / 1000)} с`);
      throw classifyGeminiError(
        new Error([failure.stderr, failure.stdout, failure.message].filter(Boolean).join(' '))
      );
    }

    let reply: { status?: string; response?: string; error?: string };
    try {
      reply = JSON.parse(result.stdout);
    } catch {
      throw new GeminiError('bad_response', `agy вернул не JSON: ${result.stdout.slice(0, 120)}`);
    }
    if (reply.status !== 'SUCCESS' || typeof reply.response !== 'string') {
      throw classifyGeminiError(new Error(reply.error ?? `agy status ${reply.status ?? 'unknown'}`));
    }
    if (reply.response.trim() === '') {
      try {
        onEmptyResponse({
          stdout: result.stdout,
          stderr: result.stderr,
          status: reply.status,
          keys: Object.keys(reply),
          model,
          durationMs: Date.now() - startedAt,
        });
      } catch {
        // Logging must not change the model result or hide the parser's error.
      }
    }
    return reply.response;
  }

  async function inTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tobacconist-agy-'));
    try {
      return await work(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  return {
    generateFromImage: ({ imageBase64, mimeType, prompt }) =>
      inTempDir(async (dir) => {
        const file = path.join(dir, `screenshot.${EXTENSIONS[mimeType] ?? 'jpg'}`);
        await fs.writeFile(file, Buffer.from(imageBase64, 'base64'));
        return ask(`Use only the built-in read_file tool to inspect the image. Do not use Bash, command, shell, Python, or any other tool. Read the image file "${file}" and return JSON only.\n\n${prompt}`, dir);
      }),
    generateText: ({ prompt }) => inTempDir((dir) => ask(prompt, dir)),
  };
}
