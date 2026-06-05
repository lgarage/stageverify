import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runInstall, defaultSourceRoot } from '../installer/install.mjs';
import { runVerify } from '../installer/verify.mjs';
import { runUpdate } from './update.mjs';
import { runRollback } from './rollback.mjs';
import {
  backupFileRel,
  createVerifiedBackup,
  resolveBackupFileAbs,
  validateBackupIntegrity,
} from './lib/backup.mjs';
import { applyRollback } from './lib/rollback-engine.mjs';
import { createTransactionId, isValidTransactionId } from './lib/transaction.mjs';
import { makeTempRepo, makeSourceVariant, mutateCoreFile } from './test-helpers.mjs';

const HOST_ROOT = defaultSourceRoot();

function installA(target, sourceRoot = HOST_ROOT) {
  const r = runInstall({ sourceRoot, targetRoot: target, write: true });
  assert.equal(r.ok, true, JSON.stringify(r.blocks));
  return r;
}

function makeBackupTarget() {
  const target = makeTempRepo('aecs-backup-');
  fs.mkdirSync(path.join(target, '.cursor', 'aecs'), { recursive: true });
  return target;
}

function minimalBackupOpts(target, transactionId, fileSpecs, filesOnDisk) {
  for (const [rel, content] of Object.entries(filesOnDisk)) {
    const abs = path.join(target, rel.replace(/\//g, path.sep));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return {
    targetRoot: target,
    transactionId,
    fileSpecs,
    installed: { schemaVersion: '0.2.0', aecsVersion: '0.1.0', files: [] },
    ownership: null,
    version: { installed: '0.1.0', target: '0.2.0' },
  };
}

test('backup: nested path vs filename containing __ — distinct storage', () => {
  const target = makeBackupTarget();
  const txn = createTransactionId();
  const nested = 'pkg/a/b.txt';
  const flatish = 'pkg/a__b.txt';
  const result = createVerifiedBackup(
    minimalBackupOpts(target, txn, [
      { relPath: nested, required: true },
      { relPath: flatish, required: true },
    ], {
      [nested]: 'nested-content\n',
      [flatish]: 'flatish-content\n',
    }),
  );
  assert.equal(result.ok, true, JSON.stringify(result));

  const nestedAbs = resolveBackupFileAbs(target, txn, nested);
  const flatishAbs = resolveBackupFileAbs(target, txn, flatish);
  assert.notEqual(nestedAbs, flatishAbs);
  assert.equal(fs.readFileSync(nestedAbs, 'utf8'), 'nested-content\n');
  assert.equal(fs.readFileSync(flatishAbs, 'utf8'), 'flatish-content\n');
  assert.equal(backupFileRel(nested), 'files/pkg/a/b.txt');
  assert.equal(backupFileRel(flatish), 'files/pkg/a__b.txt');
});

test('backup: old __ encoding collision paths map to separate files', () => {
  const target = makeBackupTarget();
  const txn = createTransactionId();
  const pathA = 'a/b';
  const pathB = 'a__b';
  const result = createVerifiedBackup(
    minimalBackupOpts(target, txn, [
      { relPath: pathA, required: true },
      { relPath: pathB, required: true },
    ], {
      [pathA]: 'from-a/b\n',
      [pathB]: 'from-a__b\n',
    }),
  );
  assert.equal(result.ok, true);
  assert.notEqual(
    resolveBackupFileAbs(target, txn, pathA),
    resolveBackupFileAbs(target, txn, pathB),
  );
  const integrity = validateBackupIntegrity(target, txn);
  assert.equal(integrity.ok, true);
});

test('backup: Windows case-insensitive duplicate paths blocked', () => {
  if (process.platform !== 'win32') {
    return;
  }
  const target = makeBackupTarget();
  const txn = createTransactionId();
  const result = createVerifiedBackup(
    minimalBackupOpts(target, txn, [
      { relPath: 'Aecs/Core/File.txt', required: true },
      { relPath: 'aecs/core/file.txt', required: true },
    ], {
      'Aecs/Core/File.txt': 'upper\n',
      'aecs/core/file.txt': 'lower\n',
    }),
  );
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /Duplicate backup path/i);
});

test('backup: duplicate normalized paths block creation', () => {
  const target = makeBackupTarget();
  const txn = createTransactionId();
  const rel = 'dup/file.txt';
  const result = createVerifiedBackup(
    minimalBackupOpts(target, txn, [
      { relPath: rel, required: true },
      { relPath: rel, required: true },
    ], {
      [rel]: 'once\n',
    }),
  );
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /Duplicate backup path/i);
});

test('backup: rollback restores similarly named paths correctly', () => {
  const target = makeBackupTarget();
  fs.writeFileSync(
    path.join(target, '.cursor', 'aecs', 'installed-manifest.json'),
    JSON.stringify({ schemaVersion: '0.2.0', aecsVersion: '0.1.0', files: [] }, null, 2),
  );
  const txn = createTransactionId();
  const pathA = 'a/b.txt';
  const pathB = 'a__b.txt';
  const backup = createVerifiedBackup(
    minimalBackupOpts(target, txn, [
      { relPath: pathA, required: true },
      { relPath: pathB, required: true },
    ], {
      [pathA]: 'content-a/b\n',
      [pathB]: 'content-a__b\n',
    }),
  );
  assert.equal(backup.ok, true);

  fs.writeFileSync(path.join(target, pathA.replace(/\//g, path.sep)), 'tampered-a\n');
  fs.writeFileSync(path.join(target, pathB.replace(/\//g, path.sep)), 'tampered-b\n');

  const applied = applyRollback({ targetRoot: target, transactionId: txn });
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(fs.readFileSync(path.join(target, pathA.replace(/\//g, path.sep)), 'utf8'), 'content-a/b\n');
  assert.equal(fs.readFileSync(path.join(target, pathB.replace(/\//g, path.sep)), 'utf8'), 'content-a__b\n');
});

test('backup: dot-segment paths deduplicated (a/./b vs a/b)', () => {
  const target = makeBackupTarget();
  const txn = createTransactionId();
  const result = createVerifiedBackup(
    minimalBackupOpts(target, txn, [
      { relPath: 'a/./b.txt', required: true },
      { relPath: 'a/b.txt', required: true },
    ], {
      'a/b.txt': 'once\n',
    }),
  );
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /Duplicate backup path/i);
});

test('backup: tampered checksum mapping blocks rollback', () => {
  const target = makeBackupTarget();
  const txn = createTransactionId();
  const rel = 'aecs/core/tamper.schema.json';
  createVerifiedBackup(
    minimalBackupOpts(target, txn, [{ relPath: rel, required: true }], {
      [rel]: '{}\n',
    }),
  );
  const checksumsPath = path.join(
    target,
    '.cursor/aecs/backups',
    txn,
    'checksums.json',
  );
  fs.writeFileSync(checksumsPath, '{ "wrong/path.json": "deadbeef" }\n');
  const plan = applyRollback({ targetRoot: target, transactionId: txn });
  assert.equal(plan.ok, false);
  assert.ok(plan.blocks.some((b) => b.includes('Checksum') || b.includes('Missing backup')));
});

test('rollback: failed apply does not run verify', () => {
  const target = makeTempRepo();
  installA(target);
  fs.writeFileSync(path.join(target, 'unrelated-rollback.txt'), 'stable');
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });
  const update = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.equal(update.ok, true);
  const trialsPath = path.join(target, 'aecs', 'core', 'schemas', 'trials.schema.json');
  fs.appendFileSync(trialsPath, '\n# drift blocks apply\n');

  const result = runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    sourceRoot: HOST_ROOT,
  });
  assert.equal(result.ok, false);
  assert.equal(result.applyFailed, true);
  assert.equal(result.verify, undefined);
  assert.equal(fs.readFileSync(path.join(target, 'unrelated-rollback.txt'), 'utf8'), 'stable');
});

test('rollback: successful apply invokes verify', () => {
  const target = makeTempRepo();
  installA(target);
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
  });
  const update = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.equal(update.ok, true);
  const result = runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    sourceRoot: HOST_ROOT,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.verify);
  assert.equal(result.verify.ok, true);
});

test('transaction id: createTransactionId passes validation', () => {
  for (let i = 0; i < 5; i++) {
    const id = createTransactionId();
    assert.equal(isValidTransactionId(id), true, id);
  }
});

test('transaction id: rejects malformed and unsafe values', () => {
  const invalid = [
    '',
    'txn',
    'txn-not-a-date-abcdef12',
    'txn-2026-13-45T12-00-00-000Z-abcdef12',
    'txn-2026-06-05T12-00-00-000Z-abc',
    'txn-2026-06-05T12-00-00-000Z-abcdefgh',
    'txn-2026-06-05T12-00-00-000Z-abcdef12-extra',
    'txn-2026-06-05T12-00-00-000Z',
    'prefix-2026-06-05T12-00-00-000Z-abcdef12',
    'txn-2026-06-05T12-00-00-000Z-abcdef12/evil',
    'txn-2026-06-05T12-00-00-000Z-abcdef12\\evil',
    'txn-../2026-06-05T12-00-00-000Z-abcdef12',
    'txn-2026-06-05T12:00:00.000Z-abcdef12',
  ];
  for (const id of invalid) {
    assert.equal(isValidTransactionId(id), false, `expected invalid: ${id}`);
  }
  assert.equal(isValidTransactionId('txn-2026-06-05T12-00-00-000Z-deadbeef'), true);
});

test('transaction id: invalid id blocks rollback before backup lookup', () => {
  const target = makeTempRepo();
  installA(target);
  const result = runRollback({
    targetRoot: target,
    transactionId: 'txn-2026-13-99T99-99-99-999Z-abcdef12',
    write: false,
  });
  assert.equal(result.ok, false);
  assert.ok(result.blocks.some((b) => b.includes('Invalid transaction id')));
});

test('E2E disposable: A→B update, verify B, rollback A, cleanup', () => {
  const target = makeTempRepo('aecs-e2e-');
  installA(target);
  fs.writeFileSync(path.join(target, 'e2e-unrelated.txt'), 'untouched');

  const nestedRel = 'aecs/core/e2e-nested/x.schema.json';
  const flatRel = 'aecs/core/e2e-nested__x.schema.json';
  fs.mkdirSync(path.dirname(path.join(target, nestedRel.replace(/\//g, path.sep))), {
    recursive: true,
  });
  fs.writeFileSync(path.join(target, nestedRel.replace(/\//g, path.sep)), '{ "v": "a-nested" }\n');
  fs.writeFileSync(path.join(target, flatRel.replace(/\//g, path.sep)), '{ "v": "a-flat" }\n');

  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n/* e2e b */\n');
  });
  const update = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.equal(update.ok, true, JSON.stringify(update));
  const verifyB = runVerify({ targetRoot: target, sourceRoot: sourceB });
  assert.equal(verifyB.ok, true, JSON.stringify(verifyB.findings));

  const rollback = runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    sourceRoot: HOST_ROOT,
  });
  assert.equal(rollback.ok, true, JSON.stringify(rollback));

  const manifest = JSON.parse(
    fs.readFileSync(path.join(target, '.cursor', 'aecs', 'installed-manifest.json'), 'utf8'),
  );
  assert.notEqual(manifest.aecsVersion, '0.2.0');
  assert.equal(fs.readFileSync(path.join(target, 'e2e-unrelated.txt'), 'utf8'), 'untouched');

  fs.rmSync(target, { recursive: true, force: true });
});
