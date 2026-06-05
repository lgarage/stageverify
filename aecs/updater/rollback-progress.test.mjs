import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runInstall, defaultSourceRoot } from '../installer/install.mjs';
import { runUpdate } from './update.mjs';
import { runRollback } from './rollback.mjs';
import { ROLLBACK_PROGRESS_REL } from './lib/constants.mjs';
import {
  readRollbackInProgress,
  writeRollbackInProgress,
  writeUpdateInProgress,
} from './lib/progress.mjs';
import { makeTempRepo, makeSourceVariant, mutateCoreFile, addManifestFile } from './test-helpers.mjs';

const HOST_ROOT = defaultSourceRoot();

function installA(target, sourceRoot = HOST_ROOT) {
  const r = runInstall({ sourceRoot, targetRoot: target, write: true });
  assert.equal(r.ok, true, JSON.stringify(r.blocks));
  return r;
}

function updateToB(target) {
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n/* rb-progress */\n');
  });
  const update = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.equal(update.ok, true, JSON.stringify(update));
  return { update, sourceB };
}

function progressPath(target) {
  return path.join(target, ROLLBACK_PROGRESS_REL.replace(/\//g, path.sep));
}

test('MED-2.1 rollback-in-progress record exists on simulated first-op failure', () => {
  const target = makeTempRepo();
  installA(target);
  const { update } = updateToB(target);
  assert.ok(!fs.existsSync(progressPath(target)));

  const result = runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    simulateApplyFailureAfter: 0,
    sourceRoot: HOST_ROOT,
  });
  assert.equal(result.ok, false);
  assert.ok(fs.existsSync(progressPath(target)));
  const record = readRollbackInProgress(target);
  assert.ok(record && !('malformed' in record));
  assert.equal(record.status, 'failed');
  assert.equal(record.completedOperationCount, 0);
});

test('MED-2.2 progress advances completedOperationIds after partial apply', () => {
  const target = makeTempRepo();
  installA(target);
  const extraRel = 'aecs/core/schemas/med2-partial.schema.json';
  const sourceB = makeSourceVariant(HOST_ROOT, '0.2.0', (s) => {
    mutateCoreFile(s, 'aecs/core/schemas/trials.schema.json', '\n');
    addManifestFile(s, extraRel, '{}\n');
  });
  const update = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.equal(update.ok, true);

  const result = runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    simulateApplyFailureAfter: 1,
    sourceRoot: HOST_ROOT,
  });
  assert.equal(result.ok, false);
  assert.equal(result.partialFailure, true);
  const record = readRollbackInProgress(target);
  assert.ok(record && !('malformed' in record));
  assert.equal(record.status, 'failed');
  assert.ok(record.completedOperationCount >= 1);
  assert.ok(record.completedOperationIds.length >= 1);
  assert.ok(record.lastSuccessfulStep);
});

test('MED-2.3 successful rollback clears rollback-in-progress after verify', () => {
  const target = makeTempRepo();
  installA(target);
  const { update } = updateToB(target);
  const rollback = runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    sourceRoot: HOST_ROOT,
  });
  assert.equal(rollback.ok, true, JSON.stringify(rollback));
  assert.equal(rollback.rollbackProgress, null);
  assert.ok(!fs.existsSync(progressPath(target)));
});

test('MED-2.4 simulated failure preserves failure block and recoveryGuidance', () => {
  const target = makeTempRepo();
  installA(target);
  const { update } = updateToB(target);
  runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    simulateApplyFailureAfter: 0,
    sourceRoot: HOST_ROOT,
  });
  const record = readRollbackInProgress(target);
  assert.ok(record && !('malformed' in record));
  assert.equal(record.failure?.status, 'failed');
  assert.match(record.failure?.error ?? '', /Simulated rollback apply failure/);
  assert.match(record.recoveryGuidance, /no auto-resume/i);
});

test('MED-2.5 install write blocked when rollback incomplete', () => {
  const target = makeTempRepo();
  installA(target);
  const { update } = updateToB(target);
  runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    simulateApplyFailureAfter: 0,
    sourceRoot: HOST_ROOT,
  });
  const reinstall = runInstall({ sourceRoot: HOST_ROOT, targetRoot: target, write: true });
  assert.equal(reinstall.ok, false);
  assert.ok(reinstall.blocks.some((b) => b.includes('rollback-in-progress')));
});

test('MED-2.6 update write blocked when rollback incomplete', () => {
  const target = makeTempRepo();
  installA(target);
  const { update, sourceB } = updateToB(target);
  runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    simulateApplyFailureAfter: 0,
    sourceRoot: HOST_ROOT,
  });
  const blocked = runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.blocks.some((b) => b.includes('rollback-in-progress')));
});

test('MED-2.7 concurrent rollback write blocked when rollback incomplete', () => {
  const target = makeTempRepo();
  installA(target);
  const { update } = updateToB(target);
  runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    simulateApplyFailureAfter: 0,
    sourceRoot: HOST_ROOT,
  });
  const retry = runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    sourceRoot: HOST_ROOT,
  });
  assert.equal(retry.ok, false);
  assert.ok(retry.blocks.some((b) => b.includes('Rollback incomplete')));
});

test('MED-2.8 rollback dry-run allowed when rollback incomplete (read-only inspect)', () => {
  const target = makeTempRepo();
  installA(target);
  const { update } = updateToB(target);
  runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    simulateApplyFailureAfter: 0,
    sourceRoot: HOST_ROOT,
  });
  const dry = runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: false,
  });
  assert.equal(dry.dryRun, true);
  assert.ok(dry.rollbackProgress);
});

test('MED-2.9 list backups allowed when rollback incomplete', () => {
  const target = makeTempRepo();
  installA(target);
  const { update } = updateToB(target);
  runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    simulateApplyFailureAfter: 0,
    sourceRoot: HOST_ROOT,
  });
  const listed = runRollback({ targetRoot: target, list: true });
  assert.equal(listed.ok, true);
  assert.ok(listed.list.length >= 1);
});

test('MED-2.10 rollback write allowed when update-in-progress matches backup txn', () => {
  const target = makeTempRepo();
  installA(target);
  const { update } = updateToB(target);
  writeUpdateInProgress(target, update.transactionId);
  const rollback = runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    sourceRoot: HOST_ROOT,
  });
  assert.equal(rollback.ok, true, JSON.stringify(rollback));
  assert.ok(!fs.existsSync(progressPath(target)));
});

test('MED-2.11 malformed rollback-in-progress blocks rollback write', () => {
  const target = makeTempRepo();
  installA(target);
  const { update } = updateToB(target);
  fs.mkdirSync(path.dirname(progressPath(target)), { recursive: true });
  fs.writeFileSync(progressPath(target), '{ "operation": "rollback", "broken": true }\n');
  const blocked = runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    sourceRoot: HOST_ROOT,
  });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.blocks.some((b) => b.includes('Malformed rollback-in-progress')));
});

test('MED-2.12 malformed rollback-in-progress blocks install and update writes', () => {
  const target = makeTempRepo();
  installA(target);
  fs.mkdirSync(path.dirname(progressPath(target)), { recursive: true });
  fs.writeFileSync(progressPath(target), 'not-json\n');
  const upd = runUpdate({ sourceRoot: HOST_ROOT, targetRoot: target, write: true });
  assert.equal(upd.ok, false);
  assert.ok(upd.blocks.some((b) => b.includes('rollback-in-progress')));
  const inst = runInstall({ sourceRoot: HOST_ROOT, targetRoot: target, write: true });
  assert.equal(inst.ok, false);
  assert.ok(inst.blocks.some((b) => b.includes('rollback-in-progress')));
});

test('MED-2.13 progress record contains no machine-specific paths', () => {
  const target = makeTempRepo();
  installA(target);
  const { update } = updateToB(target);
  runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    simulateApplyFailureAfter: 1,
    sourceRoot: HOST_ROOT,
  });
  const raw = fs.readFileSync(progressPath(target), 'utf8');
  assert.ok(!raw.includes('C:\\Users'));
  assert.ok(!raw.match(/[A-Z]:\\Projects\\/));
  const record = readRollbackInProgress(target);
  assert.ok(record && !('malformed' in record));
  assert.equal(record.operation, 'rollback');
  assert.ok(record.sourceBackupTransactionId.startsWith('txn-'));
});

test('MED-2.14 pending-verify status blocks install/update/rollback writes', () => {
  const target = makeTempRepo();
  installA(target);
  const { update, sourceB } = updateToB(target);
  writeRollbackInProgress({
    targetRoot: target,
    sourceBackupTransactionId: update.transactionId,
    plannedOperationCount: 3,
  });
  const record = readRollbackInProgress(target);
  assert.ok(record && !('malformed' in record));
  record.status = 'pending-verify';
  fs.writeFileSync(progressPath(target), `${JSON.stringify(record, null, 2)}\n`);

  assert.equal(runInstall({ sourceRoot: HOST_ROOT, targetRoot: target, write: true }).ok, false);
  assert.equal(runUpdate({ sourceRoot: sourceB, targetRoot: target, write: true }).ok, false);
  const rb = runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    sourceRoot: HOST_ROOT,
  });
  assert.equal(rb.ok, false);
  assert.ok(rb.blocks.some((b) => b.includes('Rollback incomplete')));
});

test('MED-2.16 update-in-progress blocks install write', () => {
  const target = makeTempRepo();
  installA(target);
  writeUpdateInProgress(target, 'txn-2026-06-05T12-00-00-000Z-deadbeef');
  const result = runInstall({ sourceRoot: HOST_ROOT, targetRoot: target, write: true });
  assert.equal(result.ok, false);
  assert.ok(result.blocks.some((b) => b.includes('update-in-progress')));
});

test('MED-2.15 read-only dry-run returns rollbackProgress without clearing', () => {
  const target = makeTempRepo();
  installA(target);
  const { update } = updateToB(target);
  runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: true,
    simulateApplyFailureAfter: 0,
    sourceRoot: HOST_ROOT,
  });
  const before = fs.readFileSync(progressPath(target), 'utf8');
  const dry = runRollback({
    targetRoot: target,
    transactionId: update.transactionId,
    write: false,
  });
  assert.ok(dry.rollbackProgress);
  assert.equal(fs.readFileSync(progressPath(target), 'utf8'), before);
});
