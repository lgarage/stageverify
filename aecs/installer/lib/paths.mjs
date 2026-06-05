import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolved-path containment: exact root or child under root (trailing sep required).
 * On Windows, drive-letter and path casing may differ between realpath and resolve.
 * @param {string} rootReal
 * @param {string} candReal
 * @param {NodeJS.Platform} [platform]
 */
export function isInsideRoot(rootReal, candReal, platform = process.platform) {
  if (platform === 'win32') {
    const r = rootReal.toLowerCase();
    const c = candReal.toLowerCase();
    const sep = path.win32.sep;
    return c === r || c.startsWith(r + sep);
  }
  const sep = '/';
  return candReal === rootReal || candReal.startsWith(rootReal + sep);
}

/**
 * @param {string} root
 * @param {string} relative
 */
export function resolveUnderRoot(root, relative) {
  const normalized = relative.replace(/\\/g, '/');
  if (path.isAbsolute(normalized) || normalized.includes('..')) {
    throw new Error(`Path escape rejected: ${relative}`);
  }
  const joined = path.resolve(root, normalized);
  const rootResolved = path.resolve(root);
  if (!isInsideRoot(rootResolved, joined)) {
    throw new Error(`Path outside target root: ${relative}`);
  }
  return joined;
}

/**
 * @param {string} root
 * @param {string} relative
 */
export function assertInsideRoot(root, relative) {
  return resolveUnderRoot(root, relative);
}

/**
 * @param {string} p
 * @returns {string}
 */
export function normalizeRel(p) {
  return p.replace(/\\/g, '/');
}

/**
 * @param {string} dir
 * @returns {boolean}
 */
export function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @param {string} dir
 * @returns {boolean}
 */
export function isGitRepoRoot(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

/**
 * Best-effort realpath; returns resolved path or original on failure.
 * @param {string} p
 */
export function safeRealpath(p) {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * @param {string} root
 * @param {string} candidate
 */
export function assertNoSymlinkEscape(root, candidate) {
  const rootReal = safeRealpath(root);
  const candReal = safeRealpath(candidate);
  if (!isInsideRoot(rootReal, candReal)) {
    throw new Error(`Symlink escape detected: ${candidate}`);
  }
  return candReal;
}

/**
 * Detect AECS development host (has aecs/dev).
 * @param {string} targetRoot
 */
export function isAecsDevHost(targetRoot) {
  return fs.existsSync(path.join(targetRoot, 'aecs', 'dev'));
}

/**
 * @param {string} sourceRoot
 * @param {string} targetRoot
 */
export function assertValidTarget(sourceRoot, targetRoot) {
  if (!targetRoot) {
    throw new Error('--target is required');
  }
  if (!isDirectory(targetRoot)) {
    throw new Error(`Target is not a directory: ${targetRoot}`);
  }
  if (!isGitRepoRoot(targetRoot)) {
    throw new Error(`Target is not a git repository root (missing .git): ${targetRoot}`);
  }
  const sourceReal = safeRealpath(sourceRoot);
  const targetReal = safeRealpath(targetRoot);
  if (sourceReal === targetReal) {
    throw new Error('Cannot install AECS into the canonical source repository itself');
  }
  if (isAecsDevHost(targetRoot)) {
    throw new Error(
      'Target appears to be an AECS development host (aecs/dev present); use a different target',
    );
  }
}
