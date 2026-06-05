import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertNoSymlinkEscape,
  isInsideRoot,
  resolveUnderRoot,
  safeRealpath,
} from './lib/paths.mjs';
import { runInstall, defaultSourceRoot } from './install.mjs';
import { runVerify } from './verify.mjs';

const SOURCE_ROOT = defaultSourceRoot();
const isWin = process.platform === 'win32';

/**
 * @param {string} [prefix]
 */
function makeTempRepo(prefix = 'aecs-paths-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  return dir;
}

test('isInsideRoot: uppercase root, lowercase candidate drive — same path OK', () => {
  if (!isWin) {
    assert.equal(isInsideRoot('/Repo', '/Repo', 'linux'), true);
    assert.equal(isInsideRoot('/Repo', '/Repo/sub', 'linux'), true);
    return;
  }
  assert.equal(isInsideRoot('C:\\Repo', 'c:\\Repo', 'win32'), true);
  assert.equal(isInsideRoot('C:\\Repo', 'c:\\Repo\\child', 'win32'), true);
});

test('isInsideRoot: lowercase root, uppercase candidate — same path OK', () => {
  if (!isWin) {
    return;
  }
  assert.equal(isInsideRoot('c:\\Repo', 'C:\\Repo', 'win32'), true);
  assert.equal(isInsideRoot('c:\\Repo', 'C:\\Repo\\child', 'win32'), true);
});

test('isInsideRoot: outside root — blocked', () => {
  if (!isWin) {
    assert.equal(isInsideRoot('/Repo', '/Other', 'linux'), false);
    assert.equal(isInsideRoot('/Repo', '/Repo-evil', 'linux'), false);
    return;
  }
  assert.equal(isInsideRoot('C:\\Repo', 'D:\\Repo', 'win32'), false);
  assert.equal(isInsideRoot('c:\\Repo', 'C:\\Other', 'win32'), false);
});

test('isInsideRoot: sibling prefix repo-evil vs repo — blocked', () => {
  if (!isWin) {
    assert.equal(isInsideRoot('/repo', '/repo-evil', 'linux'), false);
    assert.equal(isInsideRoot('/repo', '/repo-evil/nested', 'linux'), false);
    return;
  }
  assert.equal(isInsideRoot('C:\\repo', 'C:\\repo-evil', 'win32'), false);
  assert.equal(isInsideRoot('c:\\repo', 'C:\\repo-evil\\nested', 'win32'), false);
});

test('resolveUnderRoot: .. traversal — blocked', () => {
  const target = makeTempRepo();
  assert.throws(() => resolveUnderRoot(target, '../outside'), /Path escape/);
  assert.throws(() => resolveUnderRoot(target, 'foo/../../etc/passwd'), /Path escape|outside/);
});

test('assertNoSymlinkEscape: mixed drive casing on Windows — child path OK', () => {
  if (!isWin) {
    return;
  }
  const target = makeTempRepo();
  const rootReal = safeRealpath(target);
  const mixedCaseRoot = rootReal.replace(/^([A-Z]):/, (_, d) => `${d.toLowerCase()}:`);
  const child = path.join(target, 'aecs', 'manifest.json');
  fs.mkdirSync(path.dirname(child), { recursive: true });
  fs.writeFileSync(child, '{}');
  const mixedChild = child.replace(/^([A-Z]):/, (_, d) => `${d.toLowerCase()}:`);
  assert.doesNotThrow(() => assertNoSymlinkEscape(mixedCaseRoot, mixedChild));
});

test('symlink escape still blocked when symlink leaves root', () => {
  const target = makeTempRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aecs-paths-outside-'));
  const linkPath = path.join(target, 'escape-link');
  try {
    fs.symlinkSync(outside, linkPath, 'dir');
    assert.throws(
      () => resolveUnderRoot(target, 'escape-link/secret.txt'),
      /outside|escape/i,
    );
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EPERM' || /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return;
    }
    throw err;
  }
});

test('non-Windows isInsideRoot uses case-sensitive containment', () => {
  assert.equal(isInsideRoot('/Repo', '/repo', 'linux'), false);
  assert.equal(isInsideRoot('/Repo', '/Repo/sub', 'linux'), true);
});

test('write install with lowercase drive target succeeds on Windows', { skip: !isWin }, () => {
  const target = makeTempRepo('aecs-val-');
  const lowerTarget = target.replace(/^([A-Z]):/, (_, d) => `${d.toLowerCase()}:`);
  const result = runInstall({
    sourceRoot: SOURCE_ROOT,
    targetRoot: lowerTarget,
    write: true,
    adapterName: 'stageverify',
  });
  assert.equal(result.ok, true, JSON.stringify(result.blocks, null, 2));
  assert.ok(fs.existsSync(path.join(target, 'aecs', 'manifest.json')));
  const verify = runVerify({ targetRoot: lowerTarget, sourceRoot: SOURCE_ROOT });
  assert.equal(verify.ok, true, JSON.stringify(verify.findings, null, 2));
});
