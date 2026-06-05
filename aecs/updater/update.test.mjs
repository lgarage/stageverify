import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runInstall, defaultSourceRoot } from '../installer/install.mjs';
import { runVerify } from '../installer/verify.mjs';
import { resolveUnderRoot, isInsideRoot } from '../installer/lib/paths.mjs';
import { runUpdate } from './update.mjs';
import { runRollback } from './rollback.mjs';
import { listBackups, validateBackupIntegrity } from './lib/backup.mjs';
import {
  makeTempRepo,
  cloneAecsSource,
  bumpSourceVersion,
  mutateCoreFile,
  addManifestFile,
  removeManifestFile,
  listAllFiles,
  makeSourceVariant,
  readManifest,
  shiftFileToProjectOwned,
} from './test-helpers.mjs';
import { writeUpdateInProgress } from './lib/progress.mjs';

const HOST_ROOT = defaultSourceRoot();

function installA(target, sourceRoot = HOST_ROOT) {
  const r = runInstall({ sourceRoot, targetRoot: target, write: true });
  assert.equal(r.ok, true, JSON.stringify(r.blocks));
  return r;
}

test('1. update dry run — no writes', () => {
  const target = makeTempRepo();
  installA(target);
  const before = listAllFiles(target);
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });
  const result = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: false });
  const after = listAllFiles(target);
  assert.equal(before.length, after.length);
  assert.equal(result.dryRun, true);
  assert.equal(result.written.length, 0);
});

test('2. clean A→B update', () => {
  const target = makeTempRepo();
  installA(target);
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n/* phase4 */\n');
  });
  const result = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(target, '.cursor', 'aecs', 'installed-manifest.json'), 'utf8'),
  );
  assert.equal(manifest.aecsVersion, '0.2.0');
});

test('3. verify after update', () => {
  const target = makeTempRepo();
  installA(target);
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });
  runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  const verify = runVerify({ targetRoot: target, sourceRoot: sourceB });
  assert.equal(verify.ok, true, JSON.stringify(verify.findings));
});

test('4. new file added in target', () => {
  const target = makeTempRepo();
  installA(target);
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    addManifestFile(s, 'aecs/core/schemas/phase4-extra.schema.json', '{}\n');
  });
  const result = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.equal(result.ok, true);
  assert.ok(
    fs.existsSync(path.join(target, 'aecs', 'core', 'schemas', 'phase4-extra.schema.json')),
  );
});

test('5. obsolete file removed', () => {
  const target = makeTempRepo();
  const sourceA = makeSourceVariant(HOST_ROOT, '0.1.0', (s) => {
    addManifestFile(s, 'aecs/core/schemas/obsolete.schema.json', '{}\n');
  });
  installA(target, sourceA);
  const sourceB = cloneAecsSource(sourceA, fs.mkdtempSync(path.join(os.tmpdir(), 'aecs-src-')));
  removeManifestFile(sourceB, 'aecs/core/schemas/obsolete.schema.json');
  bumpSourceVersion(sourceB, '0.2.0');
  const result = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.equal(result.ok, true);
  assert.ok(!fs.existsSync(path.join(target, 'aecs', 'core', 'schemas', 'obsolete.schema.json')));
});

test('6. local modification blocks update', () => {
  const target = makeTempRepo();
  installA(target);
  const rulePath = path.join(target, '.cursor', 'rules', 'model-audit-gate.mdc');
  fs.appendFileSync(rulePath, '\n# local mod\n');
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });
  const result = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.equal(result.ok, false);
  assert.ok(result.blocks.some((b) => b.includes('Locally modified')));
});

test('7. project-owned collision blocks', () => {
  const target = makeTempRepo();
  installA(target);
  const adapterPath = path.join(target, 'aecs', 'adapters', 'stageverify.bindings.json');
  fs.mkdirSync(path.dirname(adapterPath), { recursive: true });
  fs.writeFileSync(adapterPath, '{"targetName":"stageverify","custom":true}\n');
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });
  const result = runUpdate({
    sourceRoot: sourceB,
    targetRoot: target,
    write: true,
    adapterName: 'stageverify',
  });
  assert.equal(result.ok, false);
  assert.ok(result.blocks.some((b) => b.includes('Project-owned') || b.includes('adapter')));
});

test('8. adapter regenerated on update', () => {
  const target = makeTempRepo();
  installA(target);
  const before = fs.readFileSync(
    path.join(target, '.cursor', 'rules', 'model-dispatch-gate.mdc'),
    'utf8',
  );
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    const tpl = path.join(s, 'aecs/core/rules/model-dispatch-gate.mdc.template');
    fs.appendFileSync(tpl, '\n<!-- phase4 marker -->\n');
  });
  const result = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.equal(result.ok, true);
  const after = fs.readFileSync(
    path.join(target, '.cursor', 'rules', 'model-dispatch-gate.mdc'),
    'utf8',
  );
  assert.notEqual(before, after);
  assert.ok(after.includes('phase4 marker'));
});

test('9. backup created and verified', () => {
  const target = makeTempRepo();
  installA(target);
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });
  const result = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.ok(result.transactionId);
  const integrity = validateBackupIntegrity(target, result.transactionId);
  assert.equal(integrity.ok, true);
  const backups = listBackups(target);
  assert.ok(backups.length >= 1);
});

test('10. backup failure blocks writes', () => {
  const target = makeTempRepo();
  installA(target);
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });
  const before = fs.readFileSync(
    path.join(target, 'aecs', 'core', 'schemas', 'trials.schema.json'),
    'utf8',
  );
  const result = runUpdate({
    sourceRoot: sourceB,
    targetRoot: target,
    write: true,
    simulateBackupFailure: true,
  });
  assert.equal(result.ok, false);
  assert.ok(result.blocks.some((b) => b.includes('Backup')));
  const after = fs.readFileSync(
    path.join(target, 'aecs', 'core', 'schemas', 'trials.schema.json'),
    'utf8',
  );
  assert.equal(before, after);
});

test('11. partial failure reported recoverable', () => {
  const target = makeTempRepo();
  installA(target);
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });
  const result = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.ok(result.transactionId);
  if (!result.ok && result.partialFailure) {
    assert.ok(result.blocks.some((b) => b.includes('rollback')));
  } else {
    assert.equal(result.ok, true);
  }
});

test('12. rollback restores version A', () => {
  const target = makeTempRepo();
  installA(target);
  const installedA = JSON.parse(
    fs.readFileSync(path.join(target, '.cursor', 'aecs', 'installed-manifest.json'), 'utf8'),
  );
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n/* b */\n');
  });
  const update = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.equal(update.ok, true);
  const rollback = runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
  });
  assert.equal(rollback.ok, true, JSON.stringify(rollback));
  const restored = JSON.parse(
    fs.readFileSync(path.join(target, '.cursor', 'aecs', 'installed-manifest.json'), 'utf8'),
  );
  assert.equal(restored.aecsVersion, installedA.aecsVersion);
});

test('13. rollback dry run — no writes', () => {
  const target = makeTempRepo();
  installA(target);
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });
  const update = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  const before = listAllFiles(target);
  const plan = runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: false,
  });
  const after = listAllFiles(target);
  assert.equal(before.length, after.length);
  assert.equal(plan.dryRun, true);
});

test('14. rollback preserves unrelated files', () => {
  const target = makeTempRepo();
  installA(target);
  fs.writeFileSync(path.join(target, 'unrelated.txt'), 'keep-me');
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });
  const update = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  runRollback({ targetRoot: target, transactionId: update.transactionId, write: true });
  assert.equal(fs.readFileSync(path.join(target, 'unrelated.txt'), 'utf8'), 'keep-me');
});

test('15. rollback detects post-update changes', () => {
  const target = makeTempRepo();
  installA(target);
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });
  const update = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  const trialsPath = path.join(target, 'aecs', 'core', 'schemas', 'trials.schema.json');
  fs.appendFileSync(trialsPath, '\n# post-update drift\n');
  const plan = runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: false,
  });
  assert.equal(plan.ok, false);
  assert.ok(plan.blocks.some((b) => b.includes('drift') || b.includes('changed')));
});

test('16. corrupt backup blocks rollback', () => {
  const target = makeTempRepo();
  installA(target);
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });
  const update = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  const checksumsPath = path.join(
    target,
    '.cursor/aecs/backups',
    update.transactionId,
    'checksums.json',
  );
  fs.writeFileSync(checksumsPath, '{}\n');
  const plan = runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: false,
  });
  assert.equal(plan.ok, false);
});

test('17. malformed install record blocks update', () => {
  const target = makeTempRepo();
  installA(target);
  fs.writeFileSync(
    path.join(target, '.cursor', 'aecs', 'installed-manifest.json'),
    '{ "broken": true }\n',
  );
  const result = runUpdate({ sourceRoot: HOST_ROOT, targetRoot: target, write: false });
  assert.equal(result.ok, false);
  assert.ok(result.blocks.some((b) => b.includes('schemaVersion') || b.includes('files')));
});

test('18. malformed manifest blocks update', () => {
  const target = makeTempRepo();
  installA(target);
  const badSource = fs.mkdtempSync(path.join(os.tmpdir(), 'aecs-bad-'));
  cloneAecsSource(HOST_ROOT, badSource);
  fs.writeFileSync(path.join(badSource, 'aecs', 'manifest.json'), '{ invalid\n');
  const result = runUpdate({ sourceRoot: badSource, targetRoot: target, write: false });
  assert.equal(result.ok, false);
});

test('19. path traversal blocked', () => {
  const target = makeTempRepo();
  assert.throws(() => resolveUnderRoot(target, '../outside'), /Path escape/);
});

test('20. symlink escape blocked', () => {
  const target = makeTempRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aecs-out-'));
  const linkPath = path.join(target, 'escape-link');
  try {
    fs.symlinkSync(outside, linkPath, 'dir');
    assert.throws(
      () => resolveUnderRoot(target, 'escape-link/secret.txt'),
      /outside|escape/i,
    );
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EPERM') {
      return;
    }
    throw err;
  }
});

test('21. Windows drive casing — isInsideRoot mixed case', () => {
  if (process.platform !== 'win32') {
    return;
  }
  const root = 'C:\\Projects\\aecs-casing-test';
  const child = 'c:\\projects\\aecs-casing-test\\sub\\file.txt';
  assert.equal(isInsideRoot(root, child), true);
});

test('22. downgrade blocked by default', () => {
  const target = makeTempRepo();
  installA(target);
  const sourceOld = makeSourceVariant(HOST_ROOT, '0.0.9');
  const result = runUpdate({ sourceRoot: sourceOld, targetRoot: target, write: false });
  assert.equal(result.ok, false);
  assert.ok(result.blocks.some((b) => b.includes('Downgrade')));
});

test('23. same-version no-op', () => {
  const target = makeTempRepo();
  installA(target);
  const countBefore = listAllFiles(target).length;
  const result = runUpdate({ sourceRoot: HOST_ROOT, targetRoot: target, write: true });
  assert.equal(result.ok, true);
  assert.equal(result.noOp, true);
  assert.equal(listAllFiles(target).length, countBefore);
});

test('24. no machine-specific paths in backup manifest', () => {
  const target = makeTempRepo();
  installA(target);
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });
  const update = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(target, '.cursor/aecs/backups', update.transactionId, 'manifest.json'),
      'utf8',
    ),
  );
  const serialized = JSON.stringify(manifest);
  assert.ok(!serialized.includes('C:\\Users'));
  assert.ok(!serialized.match(/[A-Z]:\\Projects\\/));
});

test('25. failed ops audit metadata present', () => {
  const target = makeTempRepo();
  installA(target);
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });
  const update = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(target, '.cursor/aecs/backups', update.transactionId, 'manifest.json'),
      'utf8',
    ),
  );
  assert.ok(manifest.audit);
  assert.equal(manifest.audit.status, 'backup-verified');
});

test('26. unrelated files unchanged on update', () => {
  const target = makeTempRepo();
  installA(target);
  fs.writeFileSync(path.join(target, 'marker.txt'), 'stable');
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });
  runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.equal(fs.readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'stable');
});

test('27. rollback removes Version B-only files', () => {
  const target = makeTempRepo();
  installA(target);
  const extraRel = 'aecs/core/schemas/phase4-extra.schema.json';
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    addManifestFile(s, extraRel, '{ "phase4": true }\n');
  });
  const update = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.equal(update.ok, true);
  const extraAbs = path.join(target, extraRel.replace(/\//g, path.sep));
  assert.ok(fs.existsSync(extraAbs));

  const rollback = runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    sourceRoot: HOST_ROOT,
  });
  assert.equal(rollback.ok, true, JSON.stringify(rollback));
  assert.ok(!fs.existsSync(extraAbs), 'Version B-only file must be removed after rollback');
});

test('28. ownership change AECS-owned → project-owned blocks update', () => {
  const target = makeTempRepo();
  const coreRel = 'aecs/core/schemas/ownership-shift.schema.json';
  const sourceA = makeSourceVariant(HOST_ROOT, '0.1.0', (s) => {
    addManifestFile(s, coreRel, '{}\n');
  });
  installA(target, sourceA);
  const sourceB = cloneAecsSource(sourceA, fs.mkdtempSync(path.join(os.tmpdir(), 'aecs-src-')));
  shiftFileToProjectOwned(sourceB, coreRel);
  bumpSourceVersion(sourceB, '0.2.0');
  const result = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: false });
  assert.equal(result.ok, false);
  assert.ok(
    result.blocks.some(
      (b) => b.includes('ownership') || b.includes('AECS-owned') || b.includes('project-owned'),
    ),
  );
});

test('29. install-in-progress blocks update (dry-run)', () => {
  const target = makeTempRepo();
  installA(target);
  fs.writeFileSync(
    path.join(target, '.cursor', 'aecs', 'install-in-progress'),
    `${new Date().toISOString()}\n`,
  );
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });
  const result = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: false });
  assert.equal(result.ok, false);
  assert.ok(result.blocks.some((b) => b.includes('install-in-progress')));
});

test('30. update-in-progress blocks concurrent update', () => {
  const target = makeTempRepo();
  installA(target);
  writeUpdateInProgress(target, 'txn-2026-06-05T12-00-00-000Z-deadbeef');
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });
  const result = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: false });
  assert.equal(result.ok, false);
  assert.ok(result.blocks.some((b) => b.includes('update-in-progress')));
});

test('31. missing required backup source blocks all update writes', () => {
  const target = makeTempRepo();
  installA(target);
  const trialsRel = 'aecs/core/schemas/trials.schema.json';
  fs.unlinkSync(path.join(target, trialsRel.replace(/\//g, path.sep)));
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, trialsRel, '\n');
  });
  const beforeManifest = fs.readFileSync(
    path.join(target, '.cursor', 'aecs', 'installed-manifest.json'),
    'utf8',
  );
  const result = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.equal(result.ok, false);
  assert.ok(result.blocks.some((b) => b.includes('Missing required backup source')));
  const afterManifest = fs.readFileSync(
    path.join(target, '.cursor', 'aecs', 'installed-manifest.json'),
    'utf8',
  );
  assert.equal(beforeManifest, afterManifest);
});

test('E2E: install A → update B → local mod blocks → rollback restores A', () => {
  const target = makeTempRepo();
  const sourceA = makeSourceVariant(HOST_ROOT, '0.1.0');
  installA(target, sourceA);
  const verifyA = runVerify({ targetRoot: target, sourceRoot: sourceA });
  assert.equal(verifyA.ok, true);

  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n/* e2e */\n');
  });
  const dry = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: false });
  assert.equal(dry.ok, true);
  assert.ok(dry.planned.length > 0);

  const write = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.equal(write.ok, true);
  const verifyB = runVerify({ targetRoot: target, sourceRoot: sourceB });
  assert.equal(verifyB.ok, true);

  const rulePath = path.join(target, '.cursor', 'rules', 'ship-loop.mdc');
  const ruleBeforeMod = fs.readFileSync(rulePath, 'utf8');
  fs.appendFileSync(rulePath, '\n# block next\n');
  const blocked = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.equal(blocked.ok, false);

  const rbDry = runRollback({
    targetRoot: target,
    transactionId: write.transactionId,
    write: false,
  });
  assert.equal(rbDry.ok, false);

  fs.writeFileSync(rulePath, ruleBeforeMod);
  const rbWrite = runRollback({
    targetRoot: target,
    transactionId: write.transactionId,
    write: true,
    sourceRoot: sourceA,
  });
  assert.equal(rbWrite.ok, true);
  const verifyRestored = runVerify({ targetRoot: target, sourceRoot: sourceA });
  assert.equal(verifyRestored.ok, true);
});
