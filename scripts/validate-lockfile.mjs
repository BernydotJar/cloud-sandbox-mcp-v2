import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

const text = await readFile(new URL('../package-lock.json', import.meta.url), 'utf8');
const lock = JSON.parse(text);

if (lock.lockfileVersion !== 3) {
  throw new Error(`Expected package-lock lockfileVersion 3, received ${lock.lockfileVersion}`);
}

const forbiddenHosts = [
  'internal.api.openai.org',
  'applied-caas-gateway',
  'localhost',
  '127.0.0.1',
];

const invalid = [];
for (const [packagePath, metadata] of Object.entries(lock.packages ?? {})) {
  if (!metadata || typeof metadata !== 'object' || typeof metadata.resolved !== 'string') continue;
  const resolved = metadata.resolved;
  if (forbiddenHosts.some((host) => resolved.includes(host))) {
    invalid.push(`${packagePath || '<root>'}: ${resolved}`);
  }
  if (resolved.startsWith('http://')) {
    invalid.push(`${packagePath || '<root>'}: insecure registry URL ${resolved}`);
  }
}

if (invalid.length > 0) {
  throw new Error(`package-lock.json contains forbidden dependency URLs:\n${invalid.join('\n')}`);
}

const yocto = lock.packages?.['node_modules/yocto-queue'];
if (yocto && yocto.version === '0.1.1') {
  throw new Error('package-lock.json contains non-existent public package yocto-queue@0.1.1; regenerate the lockfile from package.json.');
}

process.stdout.write('package-lock.json validation passed.\n');
