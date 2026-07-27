import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { relativePathForContainer, resolveSafeRelativePath } from '../src/utils/path.js';

describe('workspace path safety', () => {
  const root = path.resolve('/tmp/workspace/repo');

  it('resolves a normal relative path', () => {
    expect(resolveSafeRelativePath(root, 'src/index.ts')).toBe(path.join(root, 'src/index.ts'));
  });

  it('blocks traversal', () => {
    expect(() => resolveSafeRelativePath(root, '../../etc/passwd')).toThrow(/escapes/);
  });

  it('blocks direct .git access', () => {
    expect(() => resolveSafeRelativePath(root, '.git/config')).toThrow(/\.git/);
  });

  it('normalizes safe container paths', () => {
    expect(relativePathForContainer('./src/../src/app.ts')).toBe('src/app.ts');
  });
});
