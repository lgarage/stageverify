import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSourceManifest } from '../installer/lib/manifest.mjs';
import { runVerify } from '../installer/verify.mjs';
import { runInstall } from '../installer/install.mjs';
import { runUpdate } from '../updater/update.mjs';
import { runRollback } from '../updater/rollback.mjs';
import { makeSourceVariant, makeTempRepo, mutateCoreFile } from '../updater/test-helpers.mjs';
import { runExport } from './export.mjs';
import { verifyReleasePackage } from './lib/integrity.mjs';
import { buildReleaseFileList } from './lib/payload.mjs';

const HOST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('1. export dry-run — no writes', () => {
  const out = tempDir('aecs-export-dry-');
  const before = fs.existsSync(path.join(out, 'aecs')) ? listFiles(out) : [];
  const result = runExport({ sourceRoot: HOST_ROOT, outputRoot: out, write: false });
  assert.equal(result.ok, true);
  assert.equal(result.write, false);
  assert.ok(result.fileCount > 0);
  const after = fs.existsSync(path.join(out, 'aecs')) ? listFiles(out) : [];
  assert.deepEqual(after, before);
  fs.rmSync(out, { recursive: true, force: true });
});

test('2. successful export with --write', () => {
  const out = tempDir('aecs-export-write-');
  const result = runExport({ sourceRoot: HOST_ROOT, outputRoot: out, write: true });
  assert.equal(result.ok, true);
  assert.equal(result.write, true);
  assert.ok(fs.existsSync(path.join(out, 'aecs', 'manifest.json')));
  assert.ok(fs.existsSync(path.join(out, 'release-metadata.json')));
  fs.rmSync(out, { recursive: true, force: true });
});

test('3. exported manifest passes loadSourceManifest validation', () => {
  const out = tempDir('aecs-export-valid-');
  runExport({ sourceRoot: HOST_ROOT, outputRoot: out, write: true });
  const info = loadSourceManifest(out);
  assert.ok(info.manifest.aecsVersion);
  assert.ok(Array.isArray(info.manifest.files));
  fs.rmSync(out, { recursive: true, force: true });
});

test('4. aecs/dev/ and aecs/examples/ excluded from export', () => {
  const out = tempDir('aecs-export-nodev-');
  runExport({ sourceRoot: HOST_ROOT, outputRoot: out, write: true });
  const devPath = path.join(out, 'aecs', 'dev');
  assert.equal(fs.existsSync(devPath), false);
  assert.equal(fs.existsSync(path.join(out, 'aecs', 'examples')), false);
  const exported = listFiles(out).map((f) => f.replace(/\\/g, '/'));
  assert.ok(exported.every((f) => !f.startsWith('aecs/dev/')));
  assert.ok(exported.every((f) => !f.startsWith('aecs/examples/')));
  fs.rmSync(out, { recursive: true, force: true });
});

test('5. installer/ and updater/ included', () => {
  const out = tempDir('aecs-export-clis-');
  runExport({ sourceRoot: HOST_ROOT, outputRoot: out, write: true });
  assert.ok(fs.existsSync(path.join(out, 'aecs', 'installer', 'install.mjs')));
  assert.ok(fs.existsSync(path.join(out, 'aecs', 'updater', 'update.mjs')));
  const exported = listFiles(out).map((f) => f.replace(/\\/g, '/'));
  assert.ok(exported.some((f) => f.startsWith('aecs/installer/')));
  assert.ok(exported.some((f) => f.startsWith('aecs/updater/')));
  fs.rmSync(out, { recursive: true, force: true });
});

test('6. output path inside source root — blocked', () => {
  const nested = path.join(HOST_ROOT, 'aecs', 'release', '.test-nested-export');
  fs.mkdirSync(nested, { recursive: true });
  try {
    assert.throws(
      () => runExport({ sourceRoot: HOST_ROOT, outputRoot: nested, write: false }),
      /inside the AECS source root/,
    );
  } finally {
    fs.rmSync(nested, { recursive: true, force: true });
  }
});

test('7. release-metadata.json has integrity fields', () => {
  const out = tempDir('aecs-export-meta-');
  const result = runExport({ sourceRoot: HOST_ROOT, outputRoot: out, write: true });
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'release-metadata.json'), 'utf8'));
  assert.equal(meta.localOnly, true);
  assert.equal(meta.signed, false);
  assert.equal(meta.fileCount, result.fileCount);
  assert.equal(meta.aecsVersion, '0.2.0');
  assert.equal(meta.aecsVersion, result.aecsVersion);
  assert.equal(meta.releaseTrack, '0.2.0');
  assert.ok(meta.payloadDigest);
  assert.ok(Array.isArray(meta.files));
  assert.equal(meta.files.length, result.fileCount);
  verifyReleasePackage(out);
  fs.rmSync(out, { recursive: true, force: true });
});

test('8. default export excludes examples and StageVerify-named files', () => {
  const files = buildReleaseFileList(HOST_ROOT).map((f) => f.relPath.replace(/\\/g, '/'));
  assert.ok(!files.includes('aecs/adapters/stageverify.bindings.json'));
  assert.ok(files.includes('aecs/adapters/project-adapter.template.json'));
  assert.ok(!files.some((f) => f.startsWith('aecs/examples/')));
  assertNoStageVerifyNamedPaths(files);

  const out = tempDir('aecs-export-adapter-');
  runExport({ sourceRoot: HOST_ROOT, outputRoot: out, write: true });
  const exported = listFiles(out).map((f) => f.replace(/\\/g, '/'));
  assert.equal(
    fs.existsSync(path.join(out, 'aecs', 'adapters', 'stageverify.bindings.json')),
    false,
  );
  assert.equal(fs.existsSync(path.join(out, 'aecs', 'examples')), false);
  assert.ok(!exported.some((f) => f.startsWith('aecs/examples/')));
  assertNoStageVerifyNamedPaths(exported);

  const meta = JSON.parse(fs.readFileSync(path.join(out, 'release-metadata.json'), 'utf8'));
  assert.ok(Array.isArray(meta.excluded));
  assert.ok(meta.excluded.some((e) => e.includes('examples')));

  fs.rmSync(out, { recursive: true, force: true });
});

test('9. verifyReleasePackage rejects missing payloadDigest', () => {
  const out = tempDir('aecs-export-nodigest-');
  runExport({ sourceRoot: HOST_ROOT, outputRoot: out, write: true });
  const metaPath = path.join(out, 'release-metadata.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  delete meta.payloadDigest;
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  assert.throws(() => verifyReleasePackage(out), /payloadDigest/);
  fs.rmSync(out, { recursive: true, force: true });
});

test('10. export refuses to overwrite existing output', () => {
  const out = tempDir('aecs-export-overwrite-');
  runExport({ sourceRoot: HOST_ROOT, outputRoot: out, write: true });
  const second = runExport({ sourceRoot: HOST_ROOT, outputRoot: out, write: true });
  assert.equal(second.ok, false);
  assert.ok(second.errors?.some((e) => e.includes('already exists')));
  fs.rmSync(out, { recursive: true, force: true });
});

test('11. default install has no StageVerify-specific active config', () => {
  const exportDir = tempDir('aecs-export-neutral-');
  const target = tempDir('aecs-target-neutral-');
  fs.mkdirSync(path.join(target, '.git'), { recursive: true });
  runExport({ sourceRoot: HOST_ROOT, outputRoot: exportDir, write: true });
  const installResult = runInstall({
    sourceRoot: exportDir,
    targetRoot: target,
    write: true,
    profile: 'composer-default',
  });
  assert.equal(installResult.ok, true);
  assert.equal(installResult.adapter, null);
  assert.equal(
    fs.existsSync(path.join(target, 'aecs', 'adapters', 'stageverify.bindings.json')),
    false,
  );
  const installed = JSON.parse(
    fs.readFileSync(path.join(target, '.cursor', 'aecs', 'installed-manifest.json'), 'utf8'),
  );
  assert.equal(installed.adapter, null);
  const agentOps = fs.readFileSync(path.join(target, '.cursor', 'rules', 'agent-ops.mdc'), 'utf8');
  assert.ok(!agentOps.includes('stageverify-db'));
  assert.ok(!agentOps.includes('lgarage.github.io'));
  fs.rmSync(exportDir, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
});

test('12. disposable acceptance: export → install → verify', () => {
  const exportDir = tempDir('aecs-export-accept-');
  const target = tempDir('aecs-target-accept-');
  fs.mkdirSync(path.join(target, '.git'), { recursive: true });

  const exportResult = runExport({ sourceRoot: HOST_ROOT, outputRoot: exportDir, write: true });
  assert.equal(exportResult.ok, true);
  verifyReleasePackage(exportDir);

  const installResult = runInstall({
    sourceRoot: exportDir,
    targetRoot: target,
    write: true,
    profile: 'sonnet-default',
  });
  assert.equal(installResult.ok, true, JSON.stringify(installResult));

  const verifyResult = runVerify({ targetRoot: target });
  assert.equal(verifyResult.ok, true, JSON.stringify(verifyResult));

  fs.rmSync(exportDir, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
});

test('13. disposable E2E: export install update rollback', () => {
  const exportA = tempDir('aecs-e2e-export-a-');
  const target = makeTempRepo('aecs-e2e-target-');

  runExport({ sourceRoot: HOST_ROOT, outputRoot: exportA, write: true });
  verifyReleasePackage(exportA);

  const dryInstall = runInstall({ sourceRoot: exportA, targetRoot: target, write: false });
  assert.equal(dryInstall.dryRun, true);
  assert.equal(dryInstall.written.length, 0);

  const installA = runInstall({
    sourceRoot: exportA,
    targetRoot: target,
    write: true,
    profile: 'composer-default',
  });
  assert.equal(installA.ok, true);
  const versionA = JSON.parse(
    fs.readFileSync(path.join(target, '.cursor', 'aecs', 'installed-manifest.json'), 'utf8'),
  ).aecsVersion;

  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.1', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });

  const dryUpdate = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: false });
  assert.equal(dryUpdate.dryRun, true);

  const updateB = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.equal(updateB.ok, true, JSON.stringify(updateB));
  const versionB = JSON.parse(
    fs.readFileSync(path.join(target, '.cursor', 'aecs', 'installed-manifest.json'), 'utf8'),
  ).aecsVersion;
  assert.equal(versionB, '0.2.1');

  const memoryBefore = fs.existsSync(path.join(target, 'PROJECT_STATUS', 'CURRENT_STATE.md'))
    ? fs.readFileSync(path.join(target, 'PROJECT_STATUS', 'CURRENT_STATE.md'), 'utf8')
    : null;

  const txn = updateB.transactionId;
  assert.ok(txn);
  const rollback = runRollback({
    targetRoot: target,
    transactionId: txn,
    write: true,
  });
  assert.equal(rollback.ok, true, JSON.stringify(rollback));
  const versionRestored = JSON.parse(
    fs.readFileSync(path.join(target, '.cursor', 'aecs', 'installed-manifest.json'), 'utf8'),
  ).aecsVersion;
  assert.equal(versionRestored, versionA);

  if (memoryBefore) {
    assert.equal(
      fs.readFileSync(path.join(target, 'PROJECT_STATUS', 'CURRENT_STATE.md'), 'utf8'),
      memoryBefore,
    );
  }

  fs.rmSync(exportA, { recursive: true, force: true });
  fs.rmSync(sourceB, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
});

test('14. verifyReleasePackage rejects non-false signed field', () => {
  const out = tempDir('aecs-export-badsigned-');
  runExport({ sourceRoot: HOST_ROOT, outputRoot: out, write: true });
  const metaPath = path.join(out, 'release-metadata.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  meta.signed = true;
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  assert.throws(() => verifyReleasePackage(out), /signed/);
  fs.rmSync(out, { recursive: true, force: true });
});

test('15. update from export blocks tampered release-metadata', () => {
  const exportDir = tempDir('aecs-export-update-src-');
  const target = makeTempRepo('aecs-export-update-tgt-');
  runExport({ sourceRoot: HOST_ROOT, outputRoot: exportDir, write: true });
  const installResult = runInstall({
    sourceRoot: exportDir,
    targetRoot: target,
    write: true,
    profile: 'composer-default',
  });
  assert.equal(installResult.ok, true);

  const metaPath = path.join(exportDir, 'release-metadata.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  delete meta.payloadDigest;
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

  const updateResult = runUpdate({
    sourceRoot: exportDir,
    targetRoot: target,
    write: false,
  });
  assert.equal(updateResult.ok, false);
  assert.ok(updateResult.blocks?.some((b) => b.includes('payloadDigest')));

  fs.rmSync(exportDir, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
});

/**
 * @param {string[]} relPaths repo-relative paths using forward slashes
 */
function assertNoStageVerifyNamedPaths(relPaths) {
  const stageVerifyPattern = /stageverify/i;
  for (const rel of relPaths) {
    assert.ok(
      !stageVerifyPattern.test(rel),
      `StageVerify-named path must not appear in default export: ${rel}`,
    );
  }
}

/**
 * @param {string} root
 */
function listFiles(root) {
  /** @type {string[]} */
  const out = [];
  function walk(dir, prefix) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        walk(path.join(dir, ent.name), rel);
      } else {
        out.push(rel);
      }
    }
  }
  walk(root, '');
  return out.sort();
}
