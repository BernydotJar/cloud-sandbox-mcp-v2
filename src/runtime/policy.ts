import { AppError } from '../utils/errors.js';

const alwaysBlockedPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|[;&|]\s*)git\s+push\b/i, reason: 'use the dedicated git_push tool so credentials stay outside the workstation' },
  { pattern: /\/run\/secrets\b/i, reason: 'controller secret paths are blocked' },
  { pattern: /\/proc\/(?:1|self)\/root/i, reason: 'namespace escape paths are blocked' },
  { pattern: /\/var\/run\/docker-host\.sock/i, reason: 'the host Docker socket is never exposed to workstations' }
];

const hardenedOnlyPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|[;&|]\s*)sudo\b/i, reason: 'sudo is not available in hardened mode' },
  { pattern: /(^|[;&|]\s*)docker\b/i, reason: 'nested Docker access is not allowed in hardened mode' },
  { pattern: /(^|[;&|]\s*)podman\b/i, reason: 'nested container access is not allowed in hardened mode' },
  { pattern: /(^|[;&|]\s*)mount\b/i, reason: 'mount operations are not allowed in hardened mode' },
  { pattern: /(^|[;&|]\s*)nsenter\b/i, reason: 'namespace entry is not allowed in hardened mode' }
];

export function assertCommandAllowed(command: string, workstationMode: boolean): void {
  if (!command.trim()) throw new AppError('Command cannot be empty.', 'EMPTY_COMMAND');
  if (command.length > 20_000) throw new AppError('Command is too long.', 'COMMAND_TOO_LONG');

  const patterns = workstationMode ? alwaysBlockedPatterns : [...alwaysBlockedPatterns, ...hardenedOnlyPatterns];
  for (const entry of patterns) {
    if (entry.pattern.test(command)) {
      throw new AppError(`Command blocked: ${entry.reason}.`, 'BLOCKED_COMMAND');
    }
  }
}
