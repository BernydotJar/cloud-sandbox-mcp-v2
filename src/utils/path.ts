import path from 'node:path';
import { AppError } from './errors.js';

const blockedSegments = new Set(['.git']);

export function assertWorkspaceId(id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) {
    throw new AppError('Invalid workspace_id.', 'INVALID_WORKSPACE_ID');
  }
  return id;
}

export function resolveSafeRelativePath(root: string, requestedPath: string): string {
  if (!requestedPath || requestedPath.includes('\0')) {
    throw new AppError('A non-empty file path is required.', 'INVALID_PATH');
  }

  const normalized = requestedPath.replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some(segment => blockedSegments.has(segment))) {
    throw new AppError('Direct access to .git is not allowed.', 'BLOCKED_PATH');
  }

  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, normalized);
  const prefix = `${resolvedRoot}${path.sep}`;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) {
    throw new AppError('Path escapes the workspace repository.', 'PATH_TRAVERSAL');
  }
  return resolved;
}

export function relativePathForContainer(requestedPath: string): string {
  const normalized = path.posix.normalize(`/${requestedPath.replaceAll('\\', '/')}`).slice(1);
  if (!normalized || normalized === '.' || normalized.startsWith('../')) {
    throw new AppError('Invalid relative path.', 'INVALID_PATH');
  }
  if (normalized.split('/').includes('.git')) {
    throw new AppError('Direct access to .git is not allowed.', 'BLOCKED_PATH');
  }
  return normalized;
}
