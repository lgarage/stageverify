import fs from 'node:fs';
import path from 'node:path';
import { assertNoSymlinkEscape, resolveUnderRoot } from './paths.mjs';

/**
 * @param {string} root
 * @param {string} relPath
 */
export function ensureParentDir(root, relPath) {
  const abs = resolveUnderRoot(root, relPath);
  const dir = path.dirname(abs);
  const rootResolved = path.resolve(root);
  let cursor = rootResolved;
  const relDir = path.relative(rootResolved, dir);
  if (relDir && relDir !== '.') {
    for (const segment of relDir.split(path.sep)) {
      cursor = path.join(cursor, segment);
      if (fs.existsSync(cursor)) {
        assertNoSymlinkEscape(root, cursor);
      }
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  assertNoSymlinkEscape(root, dir);
  return abs;
}

/**
 * Atomic write: temp file in same directory then rename.
 * @param {string} root
 * @param {string} relPath
 * @param {string} content
 */
export function atomicWriteFile(root, relPath, content) {
  const abs = ensureParentDir(root, relPath);
  assertNoSymlinkEscape(root, abs);
  const tmp = `${abs}.aecs-tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, abs);
}

/**
 * @param {string} root
 * @param {string} relPath
 * @param {string} srcAbs
 */
export function atomicCopyFile(root, relPath, srcAbs) {
  const content = fs.readFileSync(srcAbs);
  const abs = ensureParentDir(root, relPath);
  assertNoSymlinkEscape(root, abs);
  const tmp = `${abs}.aecs-tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, abs);
}
