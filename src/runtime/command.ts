import { spawn } from 'node:child_process';
import type { CommandResult } from '../domain.js';

export interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
  input?: string;
}

function appendLimited(current: string, next: Buffer, maxBytes: number): string {
  const combined = Buffer.concat([Buffer.from(current), next]);
  if (combined.byteLength <= maxBytes) return combined.toString('utf8');
  const suffix = combined.subarray(combined.byteLength - maxBytes).toString('utf8');
  return `[output truncated to last ${maxBytes} bytes]\n${suffix}`;
}

export async function runCommand(
  executable: string,
  args: string[],
  options: RunCommandOptions
): Promise<CommandResult> {
  const started = Date.now();
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk, options.maxOutputBytes);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk, options.maxOutputBytes);
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? (timedOut ? 124 : 1),
        timedOut,
        stdout,
        stderr,
        durationMs: Date.now() - started
      });
    });

    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}
