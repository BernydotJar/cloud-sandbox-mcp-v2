import { describe, expect, it } from 'vitest';
import { assertCommandAllowed } from '../src/runtime/policy.js';

describe('command policy', () => {
  it('allows normal engineering commands in hardened mode', () => {
    expect(() => assertCommandAllowed('npm test && git status --short', false)).not.toThrow();
  });

  it.each(['sudo apt update', 'docker ps', 'podman ps', 'mount /dev/x /mnt'])('blocks %s in hardened mode', command => {
    expect(() => assertCommandAllowed(command, false)).toThrow(/blocked/i);
  });

  it.each(['apt-get update', 'docker ps', 'docker compose up -d', 'python3 -m venv .venv'])('allows %s in workstation mode', command => {
    expect(() => assertCommandAllowed(command, true)).not.toThrow();
  });

  it.each(['git push origin main', 'cat /run/secrets/token', 'cat /proc/1/root/etc/passwd'])('always blocks %s', command => {
    expect(() => assertCommandAllowed(command, true)).toThrow(/blocked/i);
  });
});
