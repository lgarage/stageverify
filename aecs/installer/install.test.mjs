import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { FORBIDDEN_PORTABLE_PATTERNS } from './lib/constants.mjs';
import { resolveUnderRoot } from './lib/paths.mjs';
import { runInstall, defaultSourceRoot } from './install.mjs';
import { runVerify } from './verify.mjs';

const SOURCE_ROOT = defaultSourceRoot();

/**
 * @param {string} [prefix]
 */
function makeTempRepo(prefix = 'aecs-install-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  return dir;
}

/**
 * @param {string} dir
 */
function listAllFiles(dir) {
  /** @type {string[]} */
  const out = [];
  function walk(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
      } else {
        out.push(path.relative(dir, abs).replace(/\\/g, '/'));
      }
    }
  }
  if (fs.existsSync(dir)) {
    walk(dir);
  }
  return out.sort();
}

test('1. dry run on clean temp repo — no writes', () => {
  const target = makeTempRepo();
  const before = listAllFiles(target);
  const result = runInstall({ sourceRoot: SOURCE_ROOT, targetRoot: target, write: false });
  const after = listAllFiles(target);
  assert.equal(before.length, after.length);
  assert.equal(result.dryRun, true);
  assert.equal(result.written.length, 0);
  assert.equal(result.ok, true);
});

test('2. successful install on clean temp', () => {
  const target = makeTempRepo();
  const result = runInstall({ sourceRoot: SOURCE_ROOT, targetRoot: target, write: true });
  assert.equal(result.ok, true);
  assert.ok(result.written.length > 0);
  assert.ok(fs.existsSync(path.join(target, 'aecs', 'manifest.json')));
  assert.ok(fs.existsSync(path.join(target, '.cursor', 'aecs', 'installed-manifest.json')));
});

test('3. verify successful install', () => {
  const target = makeTempRepo();
  runInstall({ sourceRoot: SOURCE_ROOT, targetRoot: target, write: true });
  const verify = runVerify({ targetRoot: target, sourceRoot: SOURCE_ROOT });
  assert.equal(verify.ok, true, JSON.stringify(verify.findings, null, 2));
});

test('4. re-install identical content', () => {
  const target = makeTempRepo();
  runInstall({ sourceRoot: SOURCE_ROOT, targetRoot: target, write: true });
  const firstManifest = fs.readFileSync(
    path.join(target, '.cursor', 'aecs', 'installed-manifest.json'),
    'utf8',
  );
  const second = runInstall({ sourceRoot: SOURCE_ROOT, targetRoot: target, write: true });
  assert.equal(second.ok, true);
  const secondManifest = fs.readFileSync(
    path.join(target, '.cursor', 'aecs', 'installed-manifest.json'),
    'utf8',
  );
  const first = JSON.parse(firstManifest);
  const again = JSON.parse(secondManifest);
  for (const f of first.files) {
    const match = again.files.find(
      (/** @type {{installedAs: string}} */ x) => x.installedAs === f.installedAs,
    );
    assert.ok(match);
    assert.equal(match.sha256, f.sha256);
  }
});

test('5. collision — project-owned adapter file', () => {
  const target = makeTempRepo();
  const adapterDir = path.join(target, 'aecs', 'adapters');
  fs.mkdirSync(adapterDir, { recursive: true });
  fs.writeFileSync(
    path.join(adapterDir, 'stageverify.bindings.json'),
    '{"targetName":"stageverify","custom":true}\n',
  );
  const result = runInstall({
    sourceRoot: SOURCE_ROOT,
    targetRoot: target,
    write: true,
    adapterName: 'stageverify',
  });
  assert.equal(result.ok, false);
  assert.ok(result.blocks.some((b) => b.includes('Project-owned') || b.includes('adapter')));
});

test('6. collision — locally modified AECS rule', () => {
  const target = makeTempRepo();
  runInstall({ sourceRoot: SOURCE_ROOT, targetRoot: target, write: true });
  const rulePath = path.join(target, '.cursor', 'rules', 'model-audit-gate.mdc');
  fs.appendFileSync(rulePath, '\n# local edit\n');
  const result = runInstall({ sourceRoot: SOURCE_ROOT, targetRoot: target, write: true });
  assert.equal(result.ok, false);
  assert.ok(
    result.blocks.some((b) => b.includes('Locally modified') || b.includes('local-override')),
  );
});

test('7. existing project memory preserved', () => {
  const target = makeTempRepo();
  const memoryDir = path.join(target, 'PROJECT_STATUS');
  fs.mkdirSync(memoryDir, { recursive: true });
  const original = '# Custom memory\n\nDo not replace.\n';
  fs.writeFileSync(path.join(memoryDir, 'CURRENT_STATE.md'), original);
  runInstall({ sourceRoot: SOURCE_ROOT, targetRoot: target, write: true });
  const after = fs.readFileSync(path.join(memoryDir, 'CURRENT_STATE.md'), 'utf8');
  assert.equal(after, original);
});

test('8. invalid/missing target', () => {
  assert.throws(
    () => runInstall({ sourceRoot: SOURCE_ROOT, targetRoot: '/nonexistent/aecs-target-xyz', write: false }),
    /not a directory|not a git/,
  );
  const notGit = fs.mkdtempSync(path.join(os.tmpdir(), 'aecs-nogit-'));
  assert.throws(
    () => runInstall({ sourceRoot: SOURCE_ROOT, targetRoot: notGit, write: false }),
    /not a git repository/,
  );
});

test('9. path traversal / boundary escape rejected', () => {
  const target = makeTempRepo();
  assert.throws(() => resolveUnderRoot(target, '../outside'), /Path escape/);
  assert.throws(() => resolveUnderRoot(target, 'foo/../../etc/passwd'), /Path escape|outside/);
});

test('10. symlink escape blocked when symlink leaves root', { skip: os.platform() === 'win32' ? false : false }, () => {
  const target = makeTempRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aecs-outside-'));
  const linkPath = path.join(target, 'escape-link');
  try {
    fs.symlinkSync(outside, linkPath, 'dir');
    assert.throws(
      () => resolveUnderRoot(target, 'escape-link/secret.txt'),
      /outside|escape/i,
    );
  } catch (err) {
    // Windows may require admin for symlinks — skip gracefully
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EPERM' || /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return;
    }
    throw err;
  }
});

test('11. partial/malformed install record fails verify', () => {
  const target = makeTempRepo();
  runInstall({ sourceRoot: SOURCE_ROOT, targetRoot: target, write: true });
  const manifestPath = path.join(target, '.cursor', 'aecs', 'installed-manifest.json');
  fs.writeFileSync(manifestPath, '{ "broken": true }\n');
  const verify = runVerify({ targetRoot: target, sourceRoot: SOURCE_ROOT });
  assert.equal(verify.ok, false);
  assert.ok(verify.findings.some((f) => f.code.includes('INSTALL') || f.code.includes('FILES')));
});

test('12. portable core has no forbidden hard-coded paths in source', () => {
  const coreRoot = path.join(SOURCE_ROOT, 'aecs', 'core');
  /** @type {string[]} */
  const hits = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
      } else {
        const content = fs.readFileSync(abs, 'utf8');
        for (const pat of FORBIDDEN_PORTABLE_PATTERNS) {
          if (pat.test(content)) {
            hits.push(path.relative(SOURCE_ROOT, abs));
          }
        }
      }
    }
  }
  walk(coreRoot);
  assert.equal(hits.length, 0, `Forbidden patterns in: ${hits.join(', ')}`);
});

test('13. no writes during dry run (file count stable)', () => {
  const target = makeTempRepo();
  fs.writeFileSync(path.join(target, 'marker.txt'), 'stay');
  const countBefore = listAllFiles(target).length;
  runInstall({ sourceRoot: SOURCE_ROOT, targetRoot: target, write: false });
  const countAfter = listAllFiles(target).length;
  assert.equal(countBefore, countAfter);
  assert.equal(fs.readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'stay');
});

test('14. failure does not alter unrelated files', () => {
  const target = makeTempRepo();
  runInstall({ sourceRoot: SOURCE_ROOT, targetRoot: target, write: true });
  fs.writeFileSync(path.join(target, 'unrelated.txt'), 'untouched');
  const rulePath = path.join(target, '.cursor', 'rules', 'model-audit-gate.mdc');
  const ruleBefore = fs.readFileSync(rulePath, 'utf8');
  fs.appendFileSync(rulePath, '\n# break reinstall\n');
  try {
    runInstall({ sourceRoot: SOURCE_ROOT, targetRoot: target, write: true });
  } catch {
    // may throw on partial — install returns blocked instead
  }
  const result = runInstall({ sourceRoot: SOURCE_ROOT, targetRoot: target, write: true });
  assert.equal(result.ok, false);
  assert.equal(fs.readFileSync(path.join(target, 'unrelated.txt'), 'utf8'), 'untouched');
  // Rule should still have the local edit, not be reverted
  assert.ok(fs.readFileSync(rulePath, 'utf8').includes('# break reinstall'));
  assert.notEqual(fs.readFileSync(rulePath, 'utf8'), ruleBefore);
});

test('cannot install into canonical source repo', () => {
  assert.throws(
    () => runInstall({ sourceRoot: SOURCE_ROOT, targetRoot: SOURCE_ROOT, write: false }),
    /canonical source/,
  );
});
